/* oxlint-disable no-console */
import boxen from 'boxen';
import gradient from 'gradient-string';

import { getRecentCommits, getSubmodulePaths } from '../git';
import type { ClassifiedFiles, FileDiff } from '../types';
import { boxColors, frappeColors, gradientColors, theme } from './theme';

// Visual bar settings
const BAR_WIDTH = 12;
const FILLED_CHAR = '█';
const EMPTY_CHAR = '░';
const MAX_PATH_LENGTH = 28;
const PATH_TRUNCATE_LENGTH = 25;
const SEPARATOR_LENGTH = 60;
const DEFAULT_COMMIT_COUNT = 3;

// Gradient for bars
const addGradient = gradient([...gradientColors.success]);
const delGradient = gradient([...gradientColors.error]);

/**
 * Generate a visual bar with gradients showing the proportion of changes
 */
const generateBar = (additions: number, deletions: number, maxChanges: number): string => {
  if (maxChanges === 0) {
    return frappeColors.surface2(EMPTY_CHAR.repeat(BAR_WIDTH));
  }

  const total = additions + deletions;
  const filledCount = Math.round((total / maxChanges) * BAR_WIDTH);
  const addCount = Math.round((additions / total) * filledCount) || 0;
  const delCount = filledCount - addCount;
  const emptyCount = BAR_WIDTH - filledCount;

  // Apply gradients to the filled portions
  const addBar = addCount > 0 ? addGradient(FILLED_CHAR.repeat(addCount)) : '';
  const delBar = delCount > 0 ? delGradient(FILLED_CHAR.repeat(delCount)) : '';
  const emptyBar = frappeColors.surface2(EMPTY_CHAR.repeat(emptyCount));

  return addBar + delBar + emptyBar;
};

/**
 * Format a single file entry with stats and visual bar
 */
const formatFileWithBar = (
  file: FileDiff,
  maxChanges: number,
  maxAddWidth: number,
  maxDelWidth: number,
): string => {
  let statusChar: string;
  if (file.status === 'added') {
    statusChar = '+';
  } else if (file.status === 'deleted') {
    statusChar = '-';
  } else {
    statusChar = '~';
  }

  let statusColor: (s: string) => string;
  if (file.status === 'added') {
    statusColor = theme.added;
  } else if (file.status === 'deleted') {
    statusColor = theme.removed;
  } else {
    statusColor = theme.modified;
  }

  // Pad numbers BEFORE applying color for proper alignment
  const addStr = `+${file.additions}`.padStart(maxAddWidth + 1);
  const delStr = `-${file.deletions}`.padStart(maxDelWidth + 1);

  const adds = file.additions > 0 ? theme.added(addStr) : frappeColors.surface2(addStr);
  const dels = file.deletions > 0 ? theme.removed(delStr) : frappeColors.surface2(delStr);
  const bar = generateBar(file.additions, file.deletions, maxChanges);

  // Truncate long paths
  let path = file.oldPath === undefined ? file.path : `${file.oldPath} → ${file.path}`;
  if (path.length > MAX_PATH_LENGTH) {
    path = `...${path.slice(-PATH_TRUNCATE_LENGTH)}`;
  }

  return `${statusColor(statusChar)} ${theme.heading(path.padEnd(MAX_PATH_LENGTH))} ${adds} ${dels}  ${bar}`;
};

/**
 * Format file stats as badges
 */
const formatFileBadges = (files: ClassifiedFiles): string => {
  const { included, summarized, excluded } = files;

  const added = included.filter((f) => f.status === 'added').length;
  const modified = included.filter((f) => f.status === 'modified').length;
  const deleted = included.filter((f) => f.status === 'deleted').length;

  const badges: string[] = [];
  if (added > 0) {
    badges.push(theme.added(`+${added} added`));
  }
  if (modified > 0) {
    badges.push(theme.modified(`~${modified} modified`));
  }
  if (deleted > 0) {
    badges.push(theme.removed(`-${deleted} deleted`));
  }
  if (summarized.length > 0) {
    badges.push(frappeColors.overlay1(`${summarized.length} summarized`));
  }
  if (excluded.length > 0) {
    badges.push(frappeColors.surface2(`${excluded.length} excluded`));
  }

  return badges.join('  ');
};

/**
 * Format line count stats
 */
const formatLineStats = (totalAdditions: number, totalDeletions: number): string => {
  return `${theme.added(`+${totalAdditions}`)} ${theme.removed(`-${totalDeletions}`)} lines`;
};

/**
 * Filter out submodules from file list
 */
const filterSubmodules = (files: FileDiff[], submodulePaths: Set<string>): FileDiff[] => {
  return files.filter((f) => !submodulePaths.has(f.path));
};

/**
 * Display the files section of the context panel
 */
const displayFilesSection = (
  files: ClassifiedFiles,
  filteredIncluded: FileDiff[],
  totalAdditions: number,
  totalDeletions: number,
): void => {
  // Calculate max values for alignment and scaling
  const maxChanges = Math.max(...filteredIncluded.map((f) => f.additions + f.deletions), 1);
  const maxAddWidth = Math.max(...filteredIncluded.map((f) => String(f.additions).length), 1);
  const maxDelWidth = Math.max(...filteredIncluded.map((f) => String(f.deletions).length), 1);

  // Section 1: Files with stats and visual bars
  const filesBadges = formatFileBadges({ ...files, included: filteredIncluded });
  const lineStats = formatLineStats(totalAdditions, totalDeletions);

  const fileLines = filteredIncluded.map((f) =>
    formatFileWithBar(f, maxChanges, maxAddWidth, maxDelWidth),
  );

  const filesContent = [
    filesBadges,
    frappeColors.surface2('─'.repeat(SEPARATOR_LENGTH)),
    ...fileLines,
  ].join('\n');

  const filesBox = boxen(filesContent, {
    borderColor: boxColors.default,
    borderStyle: 'round',
    padding: { bottom: 0, left: 1, right: 1, top: 0 },
    title: `Files  ${lineStats}`,
    titleAlignment: 'left',
  });
  console.log(filesBox);
};

/**
 * Display the recent commits section of the context panel
 */
const displayCommitsSection = async (): Promise<void> => {
  // Section 2: Recent commits for style reference
  const commits = await getRecentCommits(DEFAULT_COMMIT_COUNT);
  if (commits.length > 0) {
    const commitsContent = commits
      .map((commit) => {
        const [hash, ...messageParts] = commit.split(' ');
        const message = messageParts.join(' ');
        return `${frappeColors.yellow(hash)} ${frappeColors.subtext1(message)}`;
      })
      .join('\n');

    const commitsBox = boxen(commitsContent, {
      borderColor: boxColors.default,
      borderStyle: 'round',
      dimBorder: true,
      padding: { bottom: 0, left: 1, right: 1, top: 0 },
      title: 'Recent Commits',
      titleAlignment: 'left',
    });
    console.log(commitsBox);
  }
};

/**
 * Display the context panel with files (stats + visual bars) and commit history
 */
export const displayContextPanel = async (
  files: ClassifiedFiles,
  totalAdditions: number,
  totalDeletions: number,
): Promise<void> => {
  // Get submodule paths to filter
  const submodulePaths = await getSubmodulePaths();

  // Filter out submodules
  const filteredIncluded = filterSubmodules(files.included, submodulePaths);

  displayFilesSection(files, filteredIncluded, totalAdditions, totalDeletions);
  await displayCommitsSection();

  // Add spacing after context panel
  console.log();
};

/**
 * Display the commit message in a styled box
 */
export const displayCommitMessage = (message: string): void => {
  const messageBox = boxen(theme.heading(message), {
    borderColor: boxColors.primary,
    borderStyle: 'round',
    padding: { bottom: 1, left: 2, right: 2, top: 1 },
    title: 'Commit Message',
    titleAlignment: 'center',
  });
  console.log(messageBox);
};

/**
 * Display a success message
 */
export const displaySuccess = (message: string): void => {
  console.log(theme.success(`\n${message}\n`));
};

/**
 * Display an error message
 */
export const displayError = (message: string): void => {
  console.log(theme.error(`\n${message}\n`));
};

/**
 * Display a warning message
 */
export const displayWarning = (message: string): void => {
  console.log(theme.warning(`\n${message}\n`));
};
