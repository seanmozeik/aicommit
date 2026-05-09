import type { ChangelogEntry } from './types';

const CHANGELOG_PATH = 'CHANGELOG.md';
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
    return await file.text();
  }
  return CHANGELOG_HEADER;
};

const writeChangelog = async (newEntry: string): Promise<void> => {
  const existingContent = await readChangelog();
  const hasHeader = existingContent.match(/^# Changelog[\s\S]*?\n\n/u);

  if (!hasHeader) {
    const rest = existingContent.startsWith('#') ? '' : existingContent;
    await Bun.write(CHANGELOG_PATH, CHANGELOG_HEADER + newEntry + rest);
    return;
  }

  const firstEntryMatch = existingContent.match(/\n## \[/u);

  if (firstEntryMatch?.index !== undefined) {
    const header = existingContent.slice(0, firstEntryMatch.index + 1);
    const rest = existingContent.slice(firstEntryMatch.index + 1);
    await Bun.write(CHANGELOG_PATH, header + newEntry + rest);
  } else {
    await Bun.write(CHANGELOG_PATH, existingContent + newEntry);
  }
};

const initializeChangelog = (): Promise<void> => Bun.write(CHANGELOG_PATH, CHANGELOG_HEADER);

const extractSection = (content: string, sectionName: string): string[] => {
  const pattern = new RegExp(`### ${sectionName}\\n([\\s\\S]*?)(?=### |$)`, 'iu');
  const match = content.match(pattern);

  if (!match) return [];

  return match[1]!
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
    const version = match[1] ?? '';
    const date = match[2] ?? '';
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
    content.match(/## \[\d+\.\d+\.\d+\] - \d{4}-\d{2}-\d{2}/u)
  ) {
    return 'keepachangelog';
  }

  if (content.includes('# Changelog') || content.includes('## ')) {
    return 'other';
  }

  return 'none';
};

const generateChangelog = async (_newVersion: string, _fromRef: string | null): Promise<string> => {
  return '### Added\n- Placeholder changelog entry\n\n### Fixed\n- Placeholder fix entry\n';
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