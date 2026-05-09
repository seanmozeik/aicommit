import type { ClassifiedFiles, FileDiff, ParsedDiff } from './types.js';

// Patterns for files to exclude from diff analysis
const EXCLUDED_PATTERNS = [
  /bun\.lock$/u,
  /package-lock\.json$/u,
  /yarn\.lock$/u,
  /pnpm-lock\.yaml$/u,
  /uv\.lock$/u,
  /\.(png|jpg|jpeg|gif|ico|webp|svg)$/u,
  /\.(woff2?|ttf|eot|otf)$/u,
  /\.(mp3|mp4|wav|webm)$/u,
  /\.DS_Store$/u,
  /\.map$/u,
  /\.tsbuildinfo$/u,
  /dist\//u,
  /build\//u,
  /\.expo\//u,
  /node_modules\//u,
];

// Patterns for files that get summary only (no full diff)
const SUMMARY_ONLY_PATTERNS: RegExp[] = [];

const MAX_LINES_PER_FILE = 50;
const MAX_TOTAL_DIFF_LINES = 1500;
const TRUNCATE_HEAD_RATIO = 0.7;

const parseFileDiff = (fileDiff: string): FileDiff | null => {
  const lines = fileDiff.split('\n');
  const headerLine = lines[0] ?? '';

  // Parse paths from "a/path b/path"
  const pathMatch = /a\/(.+?) b\/(.+)/u.exec(headerLine);
  if (pathMatch === null) {
    return null;
  }

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
    if (line.startsWith('+') && !line.startsWith('+++')) {
      additions += 1;
    }
    if (line.startsWith('-') && !line.startsWith('---')) {
      deletions += 1;
    }
  }

  return {
    additions,
    deletions,
    diff: `diff --git ${fileDiff}`,
    oldPath: status === 'renamed' ? oldPath : undefined,
    path: newPath,
    status,
  };
};

/**
 * Parse unified diff output from git into structured file diffs
 */
const parseUnifiedDiff = (diffOutput: string): ParsedDiff => {
  const files: FileDiff[] = [];
  let totalAdditions = 0;
  let totalDeletions = 0;

  // Split by file boundaries (diff --git a/... b/...)
  const fileDiffs = diffOutput.split(/^diff --git /mu).filter(Boolean);

  for (const fileDiff of fileDiffs) {
    const parsed = parseFileDiff(fileDiff);
    if (parsed) {
      totalAdditions += parsed.additions;
      totalDeletions += parsed.deletions;
      files.push(parsed);
    }
  }

  return { files, totalAdditions, totalDeletions };
};

/**
 * Classify files into included, summarized, and excluded categories
 */
const classifyFiles = (files: FileDiff[]): ClassifiedFiles => {
  const included: FileDiff[] = [];
  const summarized: FileDiff[] = [];
  const excluded: FileDiff[] = [];

  for (const file of files) {
    const isExcluded = EXCLUDED_PATTERNS.some((p) => p.test(file.path));
    const isSummarized = !isExcluded && SUMMARY_ONLY_PATTERNS.some((p) => p.test(file.path));

    if (isExcluded) {
      excluded.push(file);
    } else if (isSummarized) {
      summarized.push(file);
    } else {
      included.push(file);
    }
  }

  return { excluded, included, summarized };
};

/**
 * Truncate a diff to fit within line budget
 */
const truncateDiff = (diff: string, maxLines: number): string => {
  const lines = diff.split('\n');
  if (lines.length <= maxLines) {
    return diff;
  }

  const headLines = Math.floor(maxLines * TRUNCATE_HEAD_RATIO);
  const tailLines = maxLines - headLines;
  const omitted = lines.length - maxLines;

  return [
    ...lines.slice(0, headLines),
    `... [${omitted} lines omitted] ...`,
    ...lines.slice(-tailLines),
  ].join('\n');
};

/**
 * Compress diffs to fit within token budget
 */
const compressDiffs = (files: FileDiff[]): string => {
  const diffs: string[] = [];
  let totalLines = 0;

  for (const file of files) {
    if (file.status === 'deleted') {
      diffs.push(`--- ${file.path} (deleted)`);
    } else {
      const remainingBudget = MAX_TOTAL_DIFF_LINES - totalLines;
      const fileBudget = Math.min(MAX_LINES_PER_FILE, remainingBudget);

      if (fileBudget <= 0) {
        diffs.push(`--- ${file.path} (omitted)`);
      } else {
        const truncated = truncateDiff(file.diff, fileBudget);
        totalLines += truncated.split('\n').length;

        const header = file.oldPath ? `${file.oldPath} -> ${file.path}` : file.path;
        diffs.push(`--- ${header}\n${truncated}`);
      }
    }
  }

  return diffs.join('\n\n');
};

export { classifyFiles, compressDiffs, parseUnifiedDiff };
