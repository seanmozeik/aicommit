import { $ } from 'bun';
import type { ChangelogEntry, CommitInfo, SemanticInfo } from '../types.js';
import { generateWithCloudflare } from './ai.js';
import { classifyFiles, parseUnifiedDiff } from './diff-parser.js';
import { extractSemantics } from './semantic.js';

const CHANGELOG_PATH = 'CHANGELOG.md';

const CHANGELOG_HEADER = `# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`;

/**
 * Get commits between two points (tag or HEAD)
 */
export async function getCommitsSince(fromRef: string): Promise<CommitInfo[]> {
  try {
    const output = await $`git log ${fromRef}..HEAD --oneline`.text();
    return parseCommits(output);
  } catch {
    // If no previous tag, get all commits
    const output = await $`git log --oneline`.text();
    return parseCommits(output);
  }
}

/**
 * Parse git log --oneline output into structured commits
 */
function parseCommits(output: string): CommitInfo[] {
  const conventionalPattern = /^(\w+)(?:\(([^)]+)\))?:\s*(.+)$/;

  return output
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, ...rest] = line.split(' ');
      const message = rest.join(' ');
      const match = message.match(conventionalPattern);

      if (match) {
        return {
          description: match[3],
          hash,
          message,
          scope: match[2] || undefined,
          type: match[1]
        };
      }

      return { hash, message };
    });
}

/**
 * Get diff statistics since a reference point
 */
export async function getDiffStatsSince(fromRef: string): Promise<string> {
  try {
    return await $`git diff ${fromRef}..HEAD --stat`.text();
  } catch {
    return await $`git diff --stat`.text();
  }
}

/**
 * Get full diff since a reference point (with filtering)
 */
export async function getDiffSince(fromRef: string): Promise<string> {
  try {
    return await $`git diff ${fromRef}..HEAD --diff-algorithm=minimal`.text();
  } catch {
    return await $`git diff HEAD~10..HEAD --diff-algorithm=minimal`.text();
  }
}

/**
 * Extract semantic info from changes since a reference
 */
export async function extractChangeSemantics(fromRef: string): Promise<SemanticInfo> {
  const diffOutput = await getDiffSince(fromRef);
  if (!diffOutput.trim()) {
    return { classes: [], exports: [], functions: [], types: [] };
  }

  const parsed = parseUnifiedDiff(diffOutput);
  const classified = classifyFiles(parsed.files);
  return extractSemantics(classified.included);
}

/**
 * Build the AI prompt for changelog generation
 */
function buildChangelogPrompt(
  newVersion: string,
  commits: CommitInfo[],
  diffStats: string,
  semantics: SemanticInfo
): string {
  const commitList = commits.map((c) => `- ${c.message}`).join('\n');

  const sections: string[] = [
    `Generate a user-friendly changelog for version ${newVersion}.`,
    `
## Commits
${commitList}`,
    `
## File Changes
${diffStats}`
  ];

  // Add semantic info if available
  const semanticParts: string[] = [];
  if (semantics.functions.length > 0) {
    semanticParts.push(`New/Changed Functions: ${semantics.functions.slice(0, 15).join(', ')}`);
  }
  if (semantics.classes.length > 0) {
    semanticParts.push(`New/Changed Classes: ${semantics.classes.slice(0, 10).join(', ')}`);
  }
  if (semantics.types.length > 0) {
    semanticParts.push(`New/Changed Types: ${semantics.types.slice(0, 10).join(', ')}`);
  }
  if (semantics.exports.length > 0) {
    semanticParts.push(`New/Changed Exports: ${semantics.exports.slice(0, 10).join(', ')}`);
  }

  if (semanticParts.length > 0) {
    sections.push(`
## Code Changes
${semanticParts.join('\n')}`);
  }

  sections.push(`
## Instructions
Generate a changelog entry following these rules:

1. Write for END USERS, not developers
2. Focus on what users can now DO, not implementation details
3. Group changes into these sections (omit empty ones):
   - **Added** - New features and capabilities
   - **Changed** - Changes to existing functionality
   - **Fixed** - Bug fixes
   - **Removed** - Removed features (if any)

4. Rules:
   - Use past tense (Added, Fixed, Changed)
   - Each item should be ONE clear sentence
   - Skip internal changes (refactoring, dependencies, CI/CD, tests)
   - Skip chore/build commits unless they affect users
   - Don't mention file names, function names, or technical details
   - Focus on USER IMPACT not code changes
   - If a commit adds a new feature, describe what it enables users to do
   - If a commit fixes a bug, describe what problem was fixed

5. Output ONLY the markdown changelog content (the sections)
   Do NOT include the version header - I will add that
   Do NOT include any preamble or explanation

Example output format:
### Added
- Users can now export their data to CSV format
- Added dark mode support

### Fixed
- Fixed issue where app would crash on startup`);

  return sections.join('\n');
}

/**
 * Generate changelog entry using AI
 */
export async function generateChangelog(
  newVersion: string,
  fromRef: string | null
): Promise<string> {
  const refPoint = fromRef || 'HEAD~20';

  // Gather data in parallel
  const [commits, diffStats, semantics] = await Promise.all([
    getCommitsSince(refPoint),
    getDiffStatsSince(refPoint),
    extractChangeSemantics(refPoint)
  ]);

  if (commits.length === 0) {
    throw new Error('No commits found since last release');
  }

  const prompt = buildChangelogPrompt(newVersion, commits, diffStats, semantics);
  const result = await generateWithCloudflare(prompt);

  return cleanChangelogResponse(result.text);
}

/**
 * Clean up AI response to extract just the changelog content
 */
function cleanChangelogResponse(response: string): string {
  let cleaned = response.trim();

  // Remove markdown code fences if present
  cleaned = cleaned.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');

  // Remove any preamble before the first ### section
  const firstSectionMatch = cleaned.match(/^(### )/m);
  if (firstSectionMatch?.index && firstSectionMatch.index > 0) {
    cleaned = cleaned.slice(firstSectionMatch.index);
  }

  return cleaned.trim();
}

/**
 * Format a complete changelog entry with version header
 */
export function formatChangelogEntry(version: string, content: string): string {
  const date = new Date().toISOString().split('T')[0];
  return `## [${version}] - ${date}\n\n${content}\n\n`;
}

/**
 * Check if a CHANGELOG.md exists
 */
export async function changelogExists(): Promise<boolean> {
  return await Bun.file(CHANGELOG_PATH).exists();
}

/**
 * Read the current changelog
 */
export async function readChangelog(): Promise<string> {
  const file = Bun.file(CHANGELOG_PATH);
  if (await file.exists()) {
    return await file.text();
  }
  return CHANGELOG_HEADER;
}

/**
 * Write/update the changelog with a new entry
 */
export async function writeChangelog(newEntry: string): Promise<void> {
  const existingContent = await readChangelog();

  // Find where to insert the new entry (after the header)
  const headerEndMatch = existingContent.match(/^# Changelog[\s\S]*?\n\n/);
  let header: string;
  let rest: string;

  if (headerEndMatch) {
    // Find the end of the header section (everything before first ## entry)
    const firstEntryMatch = existingContent.match(/\n## \[/);
    if (firstEntryMatch?.index) {
      header = existingContent.slice(0, firstEntryMatch.index + 1);
      rest = existingContent.slice(firstEntryMatch.index + 1);
    } else {
      header = existingContent;
      rest = '';
    }
  } else {
    // No proper header, create one
    header = CHANGELOG_HEADER;
    rest = existingContent.startsWith('#') ? '' : existingContent;
  }

  const newContent = header + newEntry + rest;
  await Bun.write(CHANGELOG_PATH, newContent);
}

/**
 * Initialize a new changelog file
 */
export async function initializeChangelog(): Promise<void> {
  await Bun.write(CHANGELOG_PATH, CHANGELOG_HEADER);
}

/**
 * Parse existing changelog to extract entries
 */
export function parseChangelog(content: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  const entryPattern = /## \[([^\]]+)\] - (\d{4}-\d{2}-\d{2})/g;
  const sections = content.split(/## \[[^\]]+\] - \d{4}-\d{2}-\d{2}/);

  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = entryPattern.exec(content)) !== null) {
    const version = match[1];
    const date = match[2];
    const sectionContent = sections[index + 1] || '';

    const entry: ChangelogEntry = {
      added: extractSection(sectionContent, 'Added'),
      changed: extractSection(sectionContent, 'Changed'),
      date,
      fixed: extractSection(sectionContent, 'Fixed'),
      removed: extractSection(sectionContent, 'Removed'),
      version
    };

    entries.push(entry);
    index++;
  }

  return entries;
}

/**
 * Extract items from a changelog section
 */
function extractSection(content: string, sectionName: string): string[] {
  const pattern = new RegExp(`### ${sectionName}\\n([\\s\\S]*?)(?=### |$)`, 'i');
  const match = content.match(pattern);

  if (!match) return [];

  return match[1]
    .split('\n')
    .map((line) => line.replace(/^-\s*/, '').trim())
    .filter(Boolean);
}

/**
 * Detect if existing changelog follows a different convention and needs migration
 */
export async function detectChangelogConvention(): Promise<'keepachangelog' | 'other' | 'none'> {
  const file = Bun.file(CHANGELOG_PATH);
  if (!(await file.exists())) {
    return 'none';
  }

  const content = await file.text();

  // Check for Keep a Changelog format
  if (
    content.includes('Keep a Changelog') ||
    content.includes('keepachangelog.com') ||
    content.match(/## \[\d+\.\d+\.\d+\] - \d{4}-\d{2}-\d{2}/)
  ) {
    return 'keepachangelog';
  }

  // Any other existing changelog
  if (content.includes('# Changelog') || content.includes('## ')) {
    return 'other';
  }

  return 'none';
}
