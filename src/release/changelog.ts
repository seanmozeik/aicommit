import { Effect } from 'effect';

import {
  CHANGELOG_SYSTEM_PROMPT,
  CODEX_CHANGELOG_OUTPUT_DESCRIPTION,
  CODEX_CHANGELOG_SYSTEM_PROMPT,
  generateChangelogWithOpenAICompatible,
} from '../ai/changelog';
import { generateWithCodex } from '../ai/codex';
import { getModelBudgets } from '../ai/model-budgets';
import { classifyFiles, parseUnifiedDiff } from '../commit/diff-parser';
import { buildBoundedPrompt, type BoundedPrompt } from '../commit/prompt';
import { extractSemantics } from '../commit/semantic';
import { isCodexCliPreset, loadPreset } from '../config/secrets';
import type { ChangelogEntry, CommitInfo, SemanticInfo } from '../domain/types';
import { ChangelogError } from '../errors/changelog-error';
import {
  getCommitsSince as getGitCommitsSince,
  getDiffSince as getGitDiffSince,
  getDiffStatsSince,
} from '../git';

const CHANGELOG_PATH = 'CHANGELOG.md';
const CONVENTIONAL_COMMIT_RE =
  /^(?<type>feat|fix|perf|refactor|docs|test|build|ci|chore|style|revert)(?:\((?<scope>[^)]+)\))?!?:\s+(?<description>.+)/u;
const CHANGELOG_HEADER = `# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`;

const formatChangelogEntry = (version: string, content: string): string => {
  const date = new Date().toISOString().split('T')[0] ?? '';
  return `## [${version}] - ${date}\n\n${content}\n\n`;
};

const changelogExists = (): Promise<boolean> => Bun.file(CHANGELOG_PATH).exists();

const readChangelog = async (): Promise<string> => {
  const file = Bun.file(CHANGELOG_PATH);
  if (await file.exists()) {
    return file.text();
  }
  return CHANGELOG_HEADER;
};

const writeChangelog = async (newEntry: string): Promise<void> => {
  const existingContent = await readChangelog();
  const hasHeader = /^# Changelog[\s\S]*?\n\n/u.exec(existingContent);

  if (hasHeader) {
    const firstEntryMatch = /\n## \[/u.exec(existingContent);
    if (firstEntryMatch?.index === undefined) {
      await Bun.write(CHANGELOG_PATH, existingContent + newEntry);
      return;
    }
    const header = existingContent.slice(0, firstEntryMatch.index + 1);
    const rest = existingContent.slice(firstEntryMatch.index + 1);
    await Bun.write(CHANGELOG_PATH, header + newEntry + rest);
  } else {
    const rest = existingContent.startsWith('#') ? '' : existingContent;
    await Bun.write(CHANGELOG_PATH, CHANGELOG_HEADER + newEntry + rest);
  }
};

const initializeChangelog = async (): Promise<void> => {
  await Bun.write(CHANGELOG_PATH, CHANGELOG_HEADER);
};

const extractSection = (content: string, sectionName: string): string[] => {
  const pattern = new RegExp(`### ${sectionName}\\n(?<section>[\\s\\S]*?)(?=### |$)`, 'iu');
  const section = content.match(pattern)?.groups?.['section'];
  if (section === undefined) {
    return [];
  }
  return section
    .split('\n')
    .map((line) => line.replace(/^-\s*/u, '').trim())
    .filter(Boolean);
};

const parseChangelog = (content: string): ChangelogEntry[] => {
  const entries: ChangelogEntry[] = [];
  const entryPattern = /## \[(?<version>[^\]]+)\] - (?<date>\d{4}-\d{2}-\d{2})/gu;
  const sections = content.split(/## \[[^\]]+\] - \d{4}-\d{2}-\d{2}/u);

  let match = entryPattern.exec(content);
  let index = 0;

  while (match !== null) {
    const version = match.groups?.['version'];
    const date = match.groups?.['date'];
    const sectionContent = sections[index + 1] ?? '';

    if (version !== undefined && date !== undefined) {
      entries.push({
        added: extractSection(sectionContent, 'Added'),
        changed: extractSection(sectionContent, 'Changed'),
        date,
        fixed: extractSection(sectionContent, 'Fixed'),
        removed: extractSection(sectionContent, 'Removed'),
        version,
      });
    }
    index += 1;
    match = entryPattern.exec(content);
  }

  return entries;
};

const detectChangelogConvention = async (): Promise<'keepachangelog' | 'other' | 'none'> => {
  const fileExists = await Bun.file(CHANGELOG_PATH).exists();

  if (!fileExists) {
    return 'none';
  }

  const content = await Bun.file(CHANGELOG_PATH).text();

  if (
    content.includes('Keep a Changelog') ||
    content.includes('keepachangelog.com') ||
    /## \[\d+\.\d+\.\d+\] - \d{4}-\d{2}-\d{2}/u.exec(content)
  ) {
    return 'keepachangelog';
  }

  if (content.includes('# Changelog') || content.includes('## ')) {
    return 'other';
  }

  return 'none';
};

const getCommitInfoSince = async (fromRef: string | null): Promise<CommitInfo[]> => {
  const output = await getGitCommitsSince(fromRef);
  return output
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash = '', ...messageParts] = line.split(' ');
      const message = messageParts.join(' ');
      const match = CONVENTIONAL_COMMIT_RE.exec(message);
      const commit: CommitInfo = { hash, message };
      const type = match?.groups?.['type'];
      const scope = match?.groups?.['scope'];
      const description = match?.groups?.['description'];
      if (type !== undefined) {
        commit.type = type;
      }
      if (scope !== undefined) {
        commit.scope = scope;
      }
      if (description !== undefined) {
        commit.description = description;
      }
      return commit;
    });
};

const extractChangeSemantics = async (fromRef: string | null): Promise<SemanticInfo> => {
  const diffOutput = await getGitDiffSince(fromRef);
  if (diffOutput.trim() === '') {
    return { classes: [], exports: [], functions: [], types: [] };
  }
  const parsed = parseUnifiedDiff(diffOutput);
  const classified = classifyFiles(parsed.files);
  return extractSemantics(classified.included);
};

const buildBudgetedChangelogPrompt = (
  newVersion: string,
  commits: readonly CommitInfo[],
  diffStats: string,
  semantics: SemanticInfo,
  inputBudget: number,
): BoundedPrompt =>
  buildBoundedPrompt({
    fixedPrefix: `Release: ${newVersion}\n\nWrite a concise user-facing Keep a Changelog body from the release commits and change context.`,
    fixedSuffix: `Rules:
- Include only relevant sections: Added, Changed, Fixed, Removed.
- Do not include the version heading or date.
- Merge duplicate or overly similar entries.
- Make entries user-facing and meaningful.
- Omit trivial internal noise when it does not affect users.
- Do not mention file names, function names, or implementation details unless the user impact requires it.`,
    inputBudget,
    sections: [
      { content: commits.map((commit) => `- ${commit.message}`).join('\n'), title: 'Commits' },
      { content: diffStats.trim() || '(none)', title: 'Diff stats' },
      {
        content:
          [
            semantics.functions.length > 0 ? `Functions: ${semantics.functions.join(', ')}` : '',
            semantics.classes.length > 0 ? `Classes: ${semantics.classes.join(', ')}` : '',
            semantics.types.length > 0 ? `Types: ${semantics.types.join(', ')}` : '',
            semantics.exports.length > 0 ? `Exports: ${semantics.exports.join(', ')}` : '',
          ]
            .filter(Boolean)
            .join('\n') || '(none)',
        title: 'Code-change hints',
      },
    ],
    systemPrompt: CHANGELOG_SYSTEM_PROMPT,
  });

const generateAiChangelog = (
  newVersion: string,
  commits: readonly CommitInfo[],
  diffStats: string,
  semantics: SemanticInfo,
  presetName: string,
): Effect.Effect<string, unknown> =>
  Effect.gen(function* generateAiChangelogGen() {
    if (presetName === '' || presetName === 'claude' || presetName === 'codex') {
      return yield* new ChangelogError({
        cause: presetName,
        message: 'Changelog generation requires a configured preset',
      });
    }

    const preset = yield* Effect.tryPromise({
      catch: (error) =>
        new ChangelogError({ cause: error, message: `Failed to load preset "${presetName}"` }),
      try: () => loadPreset(presetName),
    });
    const { maxInputTokens } = getModelBudgets(preset);
    const boundedPrompt = buildBudgetedChangelogPrompt(
      newVersion,
      commits,
      diffStats,
      semantics,
      maxInputTokens,
    );
    yield* Effect.logDebug(
      `Final changelog input estimate: ${boundedPrompt.estimatedInputTokens}/${boundedPrompt.inputBudget} tokens`,
    );
    if (boundedPrompt.estimatedInputTokens > boundedPrompt.inputBudget) {
      return yield* new ChangelogError({
        cause: boundedPrompt,
        message: `Fixed changelog instructions exceed the ${boundedPrompt.inputBudget}-token input budget`,
      });
    }
    const context = yield* Effect.context();

    const generation: Effect.Effect<string, unknown> = isCodexCliPreset(preset)
      ? generateWithCodex(boundedPrompt.userPrompt, {
          model: preset.model,
          outputDescription: CODEX_CHANGELOG_OUTPUT_DESCRIPTION,
          reasoningEffort: preset.reasoningEffort,
          serviceTier: preset.serviceTier,
          systemPrompt: CODEX_CHANGELOG_SYSTEM_PROMPT,
        })
      : generateChangelogWithOpenAICompatible(boundedPrompt.userPrompt, preset);
    const markdown = yield* Effect.tryPromise({
      catch: (error) => new ChangelogError({ cause: error, message: 'AI generation failed' }),
      try: () => Effect.runPromiseWith(context)(generation),
    });
    if (markdown.trim() === '') {
      return yield* new ChangelogError({
        cause: markdown,
        message: 'Changelog model returned an empty changelog.',
      });
    }
    return markdown.trim();
  });

const generateChangelog = async (
  newVersion: string,
  fromRef: string | null,
  presetName: string,
): Promise<string> => {
  const [commits, diffStats, semantics] = await Promise.all([
    getCommitInfoSince(fromRef),
    getDiffStatsSince(fromRef),
    extractChangeSemantics(fromRef),
  ]);

  if (commits.length === 0) {
    throw new Error('No commits found since last release');
  }

  return Effect.runPromise(
    generateAiChangelog(newVersion, commits, diffStats, semantics, presetName),
  );
};

export {
  buildBudgetedChangelogPrompt,
  changelogExists,
  detectChangelogConvention,
  formatChangelogEntry,
  generateChangelog,
  initializeChangelog,
  parseChangelog,
  writeChangelog,
};
