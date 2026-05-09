import { $ } from 'bun';
import { Effect } from 'effect';

import { generateChangelogWithOpenAICompatible } from './ai-changelog';
import { classifyFiles, parseUnifiedDiff } from './diff-parser';
import { loadPreset } from './secrets';
import { extractSemantics } from './semantic';
import type { ChangelogEntry, CommitInfo, SemanticInfo } from './types';

const CHANGELOG_PATH = 'CHANGELOG.md';
const CONVENTIONAL_COMMIT_RE =
  /^(feat|fix|perf|refactor|docs|test|build|ci|chore|style|revert)(?:\(([^)]+)\))?!?:\s+(.+)/u;
const COMMIT_TYPE_GROUP = 1;
const COMMIT_SCOPE_GROUP = 2;
const COMMIT_DESCRIPTION_GROUP = 3;
const CHANGELOG_FUNCTION_HINT_LIMIT = 15;
const CHANGELOG_OTHER_HINT_LIMIT = 10;
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
  const pattern = new RegExp(`### ${sectionName}\\n([\\s\\S]*?)(?=### |$)`, 'iu');
  const match = content.match(pattern);

  if (!match) {
    return [];
  }

  return match[1]
    .split('\n')
    .map((line) => line.replace(/^-\s*/u, '').trim())
    .filter(Boolean);
};

const parseChangelog = (content: string): ChangelogEntry[] => {
  const entries: ChangelogEntry[] = [];
  const entryPattern = /## \[([^\]]+)\] - (\d{4}-\d{2}-\d{2})/gu;
  const sections = content.split(/## \[[^\]]+\] - \d{4}-\d{2}-\d{2}/u);

  let match = entryPattern.exec(content);
  let index = 0;

  while (match !== null) {
    const [, version, date] = match;
    const sectionContent = sections[index + 1] ?? '';

    const entry: ChangelogEntry = {
      added: extractSection(sectionContent, 'Added'),
      changed: extractSection(sectionContent, 'Changed'),
      date,
      fixed: extractSection(sectionContent, 'Fixed'),
      removed: extractSection(sectionContent, 'Removed'),
      version,
    };

    entries.push(entry);
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

const getCommitsSince = async (fromRef: string | null): Promise<CommitInfo[]> => {
  try {
    const output =
      fromRef === null
        ? await $`git log --oneline`.text()
        : await $`git log ${fromRef}..HEAD --oneline`.text();
    const commits = output
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [hash = '', ...messageParts] = line.split(' ');
        const message = messageParts.join(' ');
        const match = CONVENTIONAL_COMMIT_RE.exec(message);
        return {
          description: match?.at(COMMIT_DESCRIPTION_GROUP),
          hash,
          message,
          scope: match?.at(COMMIT_SCOPE_GROUP),
          type: match?.at(COMMIT_TYPE_GROUP),
        };
      });
    return commits;
  } catch {
    return [];
  }
};

const getDiffStatsSince = async (fromRef: string | null): Promise<string> => {
  try {
    return fromRef === null
      ? await $`git diff --stat`.text()
      : await $`git diff ${fromRef}..HEAD --stat`.text();
  } catch {
    return '';
  }
};

const getDiffSince = async (fromRef: string | null): Promise<string> => {
  try {
    return fromRef === null
      ? await $`git diff --diff-algorithm=minimal`.text()
      : await $`git diff ${fromRef}..HEAD --diff-algorithm=minimal`.text();
  } catch {
    return '';
  }
};

const extractChangeSemantics = async (fromRef: string | null): Promise<SemanticInfo> => {
  const diffOutput = await getDiffSince(fromRef);
  if (diffOutput.trim() === '') {
    return { classes: [], exports: [], functions: [], types: [] };
  }
  const parsed = parseUnifiedDiff(diffOutput);
  const classified = classifyFiles(parsed.files);
  return extractSemantics(classified.included);
};

const buildChangelogPrompt = (
  newVersion: string,
  commits: readonly CommitInfo[],
  diffStats: string,
  semantics: SemanticInfo,
): string => `Release: ${newVersion}

Write a concise user-facing Keep a Changelog body from the release commits and change context.
Rules:
- Include only relevant sections: Added, Changed, Fixed, Removed.
- Do not include the version heading or date.
- Merge duplicate or overly similar entries.
- Make entries user-facing and meaningful.
- Omit trivial internal noise when it does not affect users.
- Do not mention file names, function names, or implementation details unless the user impact requires it.

Commits:
${commits.map((commit) => `- ${commit.message}`).join('\n')}

Diff stats:
${diffStats.trim() || '(none)'}

Code-change hints:
${
  [
    semantics.functions.length > 0
      ? `Functions: ${semantics.functions.slice(0, CHANGELOG_FUNCTION_HINT_LIMIT).join(', ')}`
      : '',
    semantics.classes.length > 0
      ? `Classes: ${semantics.classes.slice(0, CHANGELOG_OTHER_HINT_LIMIT).join(', ')}`
      : '',
    semantics.types.length > 0
      ? `Types: ${semantics.types.slice(0, CHANGELOG_OTHER_HINT_LIMIT).join(', ')}`
      : '',
    semantics.exports.length > 0
      ? `Exports: ${semantics.exports.slice(0, CHANGELOG_OTHER_HINT_LIMIT).join(', ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n') || '(none)'
}
`;

const generateAiChangelog = (
  newVersion: string,
  commits: readonly CommitInfo[],
  diffStats: string,
  semantics: SemanticInfo,
  presetName: string,
): Effect.Effect<string, unknown> =>
  Effect.gen(function* generateAiChangelogGen() {
    if (presetName === '' || presetName === 'claude' || presetName === 'codex') {
      throw new Error('Changelog generation requires a configured OpenAI-compatible preset.');
    }

    const preset = yield* Effect.tryPromise({
      catch: (error) => {
        throw new Error(
          `Failed to load preset "${presetName}": ${error instanceof Error ? error.message : String(error)}`,
        );
      },
      try: () => loadPreset(presetName),
    });
    const prompt = buildChangelogPrompt(newVersion, commits, diffStats, semantics);
    const markdown = yield* Effect.tryPromise({
      catch: (error) => {
        throw new Error(
          `AI generation failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      },
      try: () => Effect.runPromise(generateChangelogWithOpenAICompatible(prompt, preset)),
    });
    if (markdown.trim() === '') {
      throw new Error('Changelog model returned an empty changelog.');
    }
    return markdown.trim();
  });

const generateChangelog = async (
  newVersion: string,
  fromRef: string | null,
  presetName: string,
): Promise<string> => {
  const [commits, diffStats, semantics] = await Promise.all([
    getCommitsSince(fromRef),
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
  changelogExists,
  detectChangelogConvention,
  formatChangelogEntry,
  generateChangelog,
  initializeChangelog,
  parseChangelog,
  readChangelog,
  writeChangelog,
};
