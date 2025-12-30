import boxen from 'boxen';
import gradient from 'gradient-string';
import { getRecentCommits, getSubmodulePaths } from '../lib/git.js';
import type { ClassifiedFiles, FileDiff } from '../types.js';
import { boxColors, frappe, gradientColors, theme } from './theme.js';

// Visual bar settings
const BAR_WIDTH = 12;
const FILLED_CHAR = '█';
const EMPTY_CHAR = '░';

// Gradient for bars
const addGradient = gradient([...gradientColors.success]);
const delGradient = gradient([...gradientColors.error]);

/**
 * Generate a visual bar with gradients showing the proportion of changes
 */
function generateBar(additions: number, deletions: number, maxChanges: number): string {
  if (maxChanges === 0) return frappe.surface2(EMPTY_CHAR.repeat(BAR_WIDTH));

  const total = additions + deletions;
  const filledCount = Math.round((total / maxChanges) * BAR_WIDTH);
  const addCount = Math.round((additions / total) * filledCount) || 0;
  const delCount = filledCount - addCount;
  const emptyCount = BAR_WIDTH - filledCount;

  // Apply gradients to the filled portions
  const addBar = addCount > 0 ? addGradient(FILLED_CHAR.repeat(addCount)) : '';
  const delBar = delCount > 0 ? delGradient(FILLED_CHAR.repeat(delCount)) : '';
  const emptyBar = frappe.surface2(EMPTY_CHAR.repeat(emptyCount));

  return addBar + delBar + emptyBar;
}

/**
 * Format a single file entry with stats and visual bar
 */
function formatFileWithBar(
  file: FileDiff,
  maxChanges: number,
  maxAddWidth: number,
  maxDelWidth: number
): string {
  const statusChar = file.status === 'added' ? '+' : file.status === 'deleted' ? '-' : '~';
  const statusColor =
    file.status === 'added'
      ? theme.added
      : file.status === 'deleted'
        ? theme.removed
        : theme.modified;

  // Pad numbers BEFORE applying color for proper alignment
  const addStr = `+${file.additions}`.padStart(maxAddWidth + 1);
  const delStr = `-${file.deletions}`.padStart(maxDelWidth + 1);

  const adds = file.additions > 0 ? theme.added(addStr) : frappe.surface2(addStr);
  const dels = file.deletions > 0 ? theme.removed(delStr) : frappe.surface2(delStr);
  const bar = generateBar(file.additions, file.deletions, maxChanges);

  // Truncate long paths
  let path = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path;
  if (path.length > 28) {
    path = `...${path.slice(-25)}`;
  }

  return `${statusColor(statusChar)} ${frappe.text(path.padEnd(28))} ${adds} ${dels}  ${bar}`;
}

/**
 * Format file stats as badges
 */
function formatFileBadges(files: ClassifiedFiles): string {
  const { included, summarized, excluded } = files;

  const added = included.filter((f) => f.status === 'added').length;
  const modified = included.filter((f) => f.status === 'modified').length;
  const deleted = included.filter((f) => f.status === 'deleted').length;

  const badges: string[] = [];
  if (added > 0) badges.push(theme.added(`+${added} added`));
  if (modified > 0) badges.push(theme.modified(`~${modified} modified`));
  if (deleted > 0) badges.push(theme.removed(`-${deleted} deleted`));
  if (summarized.length > 0) badges.push(frappe.overlay1(`${summarized.length} summarized`));
  if (excluded.length > 0) badges.push(frappe.surface2(`${excluded.length} excluded`));

  return badges.join('  ');
}

/**
 * Format line count stats
 */
function formatLineStats(totalAdditions: number, totalDeletions: number): string {
  return `${theme.added(`+${totalAdditions}`)} ${theme.removed(`-${totalDeletions}`)} lines`;
}

/**
 * Filter out submodules from file list
 */
function filterSubmodules(files: FileDiff[], submodulePaths: Set<string>): FileDiff[] {
  return files.filter((f) => !submodulePaths.has(f.path));
}

/**
 * Display the context panel with files (stats + visual bars) and commit history
 */
export async function displayContextPanel(
  files: ClassifiedFiles,
  totalAdditions: number,
  totalDeletions: number
): Promise<void> {
  // Get submodule paths to filter
  const submodulePaths = await getSubmodulePaths();

  // Filter out submodules
  const filteredIncluded = filterSubmodules(files.included, submodulePaths);

  // Calculate max values for alignment and scaling
  const maxChanges = Math.max(...filteredIncluded.map((f) => f.additions + f.deletions), 1);
  const maxAddWidth = Math.max(...filteredIncluded.map((f) => String(f.additions).length), 1);
  const maxDelWidth = Math.max(...filteredIncluded.map((f) => String(f.deletions).length), 1);

  // Section 1: Files with stats and visual bars
  const filesBadges = formatFileBadges({ ...files, included: filteredIncluded });
  const lineStats = formatLineStats(totalAdditions, totalDeletions);

  const fileLines = filteredIncluded.map((f) =>
    formatFileWithBar(f, maxChanges, maxAddWidth, maxDelWidth)
  );

  const filesContent = [filesBadges, frappe.surface2('─'.repeat(60)), ...fileLines].join('\n');

  const filesBox = boxen(filesContent, {
    borderColor: boxColors.default,
    borderStyle: 'round',
    padding: { bottom: 0, left: 1, right: 1, top: 0 },
    title: `Files  ${lineStats}`,
    titleAlignment: 'left'
  });
  console.log(filesBox);

  // Section 2: Recent commits for style reference
  const commits = await getRecentCommits(3);
  if (commits.length > 0) {
    const commitsContent = commits
      .map((commit) => {
        const [hash, ...messageParts] = commit.split(' ');
        const message = messageParts.join(' ');
        return `${frappe.yellow(hash)} ${frappe.subtext1(message)}`;
      })
      .join('\n');

    const commitsBox = boxen(commitsContent, {
      borderColor: boxColors.default,
      borderStyle: 'round',
      dimBorder: true,
      padding: { bottom: 0, left: 1, right: 1, top: 0 },
      title: 'Recent Commits',
      titleAlignment: 'left'
    });
    console.log(commitsBox);
  }

  console.log(); // Add spacing after context panel
}

/**
 * Display the commit message in a styled box
 */
export function displayCommitMessage(message: string): void {
  const messageBox = boxen(frappe.text(message), {
    borderColor: boxColors.primary,
    borderStyle: 'round',
    padding: { bottom: 1, left: 2, right: 2, top: 1 },
    title: 'Commit Message',
    titleAlignment: 'center'
  });
  console.log(messageBox);
}

/**
 * Display a success message
 */
export function displaySuccess(message: string): void {
  console.log(theme.success(`\n${message}\n`));
}

/**
 * Display an error message
 */
export function displayError(message: string): void {
  console.log(theme.error(`\n${message}\n`));
}

/**
 * Display a warning message
 */
export function displayWarning(message: string): void {
  console.log(theme.warning(`\n${message}\n`));
}
