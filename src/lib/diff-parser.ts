import type { ClassifiedFiles, FileDiff, ParsedDiff } from '../types.js';

// Patterns for files to exclude from diff analysis
const EXCLUDED_PATTERNS = [
  /bun\.lock$/,
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /uv\.lock$/,
  /\.(png|jpg|jpeg|gif|ico|webp|svg)$/,
  /\.(woff2?|ttf|eot|otf)$/,
  /\.(mp3|mp4|wav|webm)$/,
  /\.DS_Store$/,
  /\.map$/,
  /\.tsbuildinfo$/,
  /dist\//,
  /build\//,
  /\.expo\//,
  /node_modules\//
];

// Patterns for files that get summary only (no full diff)
const SUMMARY_ONLY_PATTERNS: RegExp[] = [];

const MAX_LINES_PER_FILE = 50;
const MAX_TOTAL_DIFF_LINES = 1500;

/**
 * Parse unified diff output from git into structured file diffs
 */
export function parseUnifiedDiff(diffOutput: string): ParsedDiff {
  const files: FileDiff[] = [];
  let totalAdditions = 0;
  let totalDeletions = 0;

  // Split by file boundaries (diff --git a/... b/...)
  const fileDiffs = diffOutput.split(/^diff --git /m).filter(Boolean);

  for (const fileDiff of fileDiffs) {
    const lines = fileDiff.split('\n');
    const headerLine = lines[0] || '';

    // Parse paths from "a/path b/path"
    const pathMatch = headerLine.match(/a\/(.+?) b\/(.+)/);
    if (!pathMatch) continue;

    const [, oldPath, newPath] = pathMatch;

    // Determine status from diff metadata
    let status: FileDiff['status'] = 'modified';
    const diffContent = fileDiff;

    if (diffContent.includes('new file mode')) {
      status = 'added';
    } else if (diffContent.includes('deleted file mode')) {
      status = 'deleted';
    } else if (diffContent.includes('rename from') || oldPath !== newPath) {
      status = 'renamed';
    }

    // Count additions/deletions (lines starting with +/- but not headers)
    let additions = 0;
    let deletions = 0;
    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) additions++;
      if (line.startsWith('-') && !line.startsWith('---')) deletions++;
    }

    totalAdditions += additions;
    totalDeletions += deletions;

    files.push({
      additions,
      deletions,
      diff: `diff --git ${fileDiff}`,
      oldPath: status === 'renamed' ? oldPath : undefined,
      path: newPath,
      status
    });
  }

  return { files, totalAdditions, totalDeletions };
}

/**
 * Classify files into included, summarized, and excluded categories
 */
export function classifyFiles(files: FileDiff[]): ClassifiedFiles {
  const included: FileDiff[] = [];
  const summarized: FileDiff[] = [];
  const excluded: FileDiff[] = [];

  for (const file of files) {
    if (EXCLUDED_PATTERNS.some((p) => p.test(file.path))) {
      excluded.push(file);
    } else if (SUMMARY_ONLY_PATTERNS.some((p) => p.test(file.path))) {
      summarized.push(file);
    } else {
      included.push(file);
    }
  }

  return { excluded, included, summarized };
}

/**
 * Truncate a diff to fit within line budget
 */
function truncateDiff(diff: string, maxLines: number): string {
  const lines = diff.split('\n');
  if (lines.length <= maxLines) return diff;

  const headLines = Math.floor(maxLines * 0.7);
  const tailLines = maxLines - headLines;
  const omitted = lines.length - maxLines;

  return [
    ...lines.slice(0, headLines),
    `... [${omitted} lines omitted] ...`,
    ...lines.slice(-tailLines)
  ].join('\n');
}

/**
 * Compress diffs to fit within token budget
 */
export function compressDiffs(files: FileDiff[]): string {
  const diffs: string[] = [];
  let totalLines = 0;

  for (const file of files) {
    if (file.status === 'deleted') {
      diffs.push(`--- ${file.path} (deleted)`);
      continue;
    }

    const remainingBudget = MAX_TOTAL_DIFF_LINES - totalLines;
    const fileBudget = Math.min(MAX_LINES_PER_FILE, remainingBudget);

    if (fileBudget <= 0) {
      diffs.push(`--- ${file.path} (omitted)`);
      continue;
    }

    const truncated = truncateDiff(file.diff, fileBudget);
    totalLines += truncated.split('\n').length;

    const header = file.oldPath ? `${file.oldPath} -> ${file.path}` : file.path;
    diffs.push(`--- ${header}\n${truncated}`);
  }

  return diffs.join('\n\n');
}
