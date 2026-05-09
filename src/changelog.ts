import { $ } from 'bun';

import type { ChangelogEntry } from './types';

const CHANGELOG_PATH = 'CHANGELOG.md';
const CONVENTIONAL_COMMIT_RE =
  /^(feat|fix|perf|refactor|docs|test|build|ci|chore|style|revert)(?:\(([^)]+)\))?!?:\s+(.+)/u;
const COMMIT_TYPE_GROUP = 1;
const COMMIT_SCOPE_GROUP = 2;
const COMMIT_DESCRIPTION_GROUP = 3;
const CHANGELOG_SECTIONS = ['Added', 'Changed', 'Fixed', 'Removed'] as const;

type ChangelogSection = (typeof CHANGELOG_SECTIONS)[number];
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

const getCommitMessagesSince = async (fromRef: string | null): Promise<string[]> => {
  try {
    const output =
      fromRef === null
        ? await $`git log --format=%s`.text()
        : await $`git log ${fromRef}..HEAD --format=%s`.text();
    return output.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
};

const formatCommitForChangelog = (message: string): { section: ChangelogSection; text: string } => {
  const match = CONVENTIONAL_COMMIT_RE.exec(message);
  if (match === null) {
    return { section: 'Changed', text: message };
  }

  const type = match.at(COMMIT_TYPE_GROUP) ?? 'chore';
  const scope = match.at(COMMIT_SCOPE_GROUP);
  const description = match.at(COMMIT_DESCRIPTION_GROUP) ?? message;
  const scoped =
    scope === undefined || scope.trim() === '' ? description : `${scope}: ${description}`;
  switch (type) {
    case 'feat': {
      return { section: 'Added', text: scoped };
    }
    case 'fix': {
      return { section: 'Fixed', text: scoped };
    }
    case 'revert': {
      return { section: 'Removed', text: scoped };
    }
    default: {
      return { section: 'Changed', text: scoped };
    }
  }
};

const renderChangelogSections = (sections: Partial<Record<ChangelogSection, string[]>>): string => {
  const rendered: string[] = [];
  for (const section of CHANGELOG_SECTIONS) {
    const sectionEntries = sections[section];
    const entries = sectionEntries === undefined ? [] : [...new Set(sectionEntries)];
    if (entries.length > 0) {
      rendered.push(`### ${section}\n\n${entries.map((entry) => `- ${entry}`).join('\n')}`);
    }
  }
  return rendered.join('\n\n');
};

const generateChangelog = async (_newVersion: string, fromRef: string | null): Promise<string> => {
  const commits = await getCommitMessagesSince(fromRef);
  const sections: Partial<Record<ChangelogSection, string[]>> = {};

  for (const commitMessage of commits) {
    const { section, text } = formatCommitForChangelog(commitMessage);
    sections[section] = [...(sections[section] ?? []), text];
  }

  return renderChangelogSections(sections) || '### Changed\n\n- Release maintenance updates';
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
