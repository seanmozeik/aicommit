import type { ClassifiedFiles, FileDiff, ParsedDiff } from '../domain/types';
import { estimateTokens } from './tokenizer';

// Patterns for files to exclude from diff analysis
const EXCLUDED_PATTERNS = [
  /bun\.lock$/u,
  /package-lock\.json$/u,
  /yarn\.lock$/u,
  /pnpm-lock\.yaml$/u,
  /uv\.lock$/u,
  /\.(?:png|jpg|jpeg|gif|ico|webp|svg)$/u,
  /\.(?:woff2?|ttf|eot|otf)$/u,
  /\.(?:mp3|mp4|wav|webm)$/u,
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

const MAX_PRIMARY_ADDED_LINES = 80;
const MAX_PRIMARY_REMOVED_LINES = 24;
const MAX_PRIMARY_CONTEXT_LINES = 16;
const MAX_SECONDARY_ADDED_LINES = 32;
const MAX_SECONDARY_REMOVED_LINES = 8;
const MAX_SECONDARY_CONTEXT_LINES = 8;
const MIN_NORMALIZED_FORMATTING_CHARS = 40;
const PRIORITY_COLUMN_WIDTH = 9;
const STATUS_COLUMN_WIDTH = 8;
const STAT_COLUMN_WIDTH = 4;

const parseFileDiff = (fileDiff: string): FileDiff | null => {
  const lines = fileDiff.split('\n');
  const headerLine = lines[0] ?? '';

  // Parse paths from "a/path b/path"
  const pathMatch = /a\/(?<oldPath>.+?) b\/(?<newPath>.+)/u.exec(headerLine);
  if (pathMatch === null) {
    return null;
  }

  const oldPath = pathMatch.groups?.['oldPath'];
  const newPath = pathMatch.groups?.['newPath'];
  if (oldPath === undefined || newPath === undefined) {
    return null;
  }

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

  return status === 'renamed'
    ? { additions, deletions, diff: `diff --git ${fileDiff}`, oldPath, path: newPath, status }
    : { additions, deletions, diff: `diff --git ${fileDiff}`, path: newPath, status };
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

interface CompressDiffsOptions {
  readonly estimator?: (text: string) => number;
  readonly tokenBudget?: number;
}

type FilePriority = 'primary' | 'secondary';

interface DigestLines {
  readonly added: readonly string[];
  readonly context: readonly string[];
  readonly formattingOnly: boolean;
  readonly removed: readonly string[];
}

const SECONDARY_FILE_PATTERNS = [
  /(?:^|\/)(?:__tests__|tests?|spec|fixtures?|snapshots?)(?:\/|$)/iu,
  /(?:\.|-)(?:test|spec)\.[cm]?[jt]sx?$/iu,
  /\.snap$/iu,
  /(?:^|\/)(?:README|CHANGELOG|LICENSE|docs?)(?:\.|\/|$)/iu,
  /(?:^|\/)(?:package\.json|tsconfig[^/]*\.json|biome\.json|eslint\.config\.)/iu,
];

const summarizeFile = (file: FileDiff): string => {
  const header = file.oldPath === undefined ? file.path : `${file.oldPath} -> ${file.path}`;
  return `### ${header}\nstatus: ${file.status}\nchanges: +${file.additions}/-${file.deletions}`;
};

const appendWithinBudget = (
  diffs: string[],
  text: string,
  currentTokens: number,
  tokenBudget: number,
  estimator: (text: string) => number,
): number => {
  const tokens = estimator(text);
  if (currentTokens + tokens <= tokenBudget) {
    diffs.push(text);
    return currentTokens + tokens;
  }
  return currentTokens;
};

const priorityOf = (file: FileDiff): FilePriority =>
  SECONDARY_FILE_PATTERNS.some((pattern) => pattern.test(file.path)) ? 'secondary' : 'primary';

const priorityRank = (file: FileDiff): number => (priorityOf(file) === 'primary' ? 0 : 1);

const normalizeChangedLine = (line: string): string => line.replaceAll(/[^\p{L}\p{N}]+/gu, '');

const isLikelyFormattingOnly = (added: readonly string[], removed: readonly string[]): boolean => {
  const normalizedAdded = added.map((line) => normalizeChangedLine(line)).join('');
  const normalizedRemoved = removed.map((line) => normalizeChangedLine(line)).join('');
  return (
    normalizedAdded.length >= MIN_NORMALIZED_FORMATTING_CHARS &&
    normalizedAdded === normalizedRemoved
  );
};

const formatBlock = (title: string, language: string, lines: readonly string[]): string => {
  if (lines.length === 0) {
    return '';
  }
  return `${title}:\n\`\`\`${language}\n${lines.join('\n')}\n\`\`\``;
};

const truncateLines = (
  lines: readonly string[],
  maxLines: number,
  label: string,
): readonly string[] => {
  if (lines.length <= maxLines) {
    return lines;
  }
  const omitted = lines.length - maxLines;
  return [...lines.slice(0, maxLines), `... [${omitted} ${label} lines omitted] ...`];
};

const digestLines = (file: FileDiff): DigestLines => {
  const added: string[] = [];
  const removed: string[] = [];
  const context: string[] = [];

  for (const line of file.diff.split('\n')) {
    const isHeader =
      line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff --git');
    if (isHeader) {
      // Header lines are metadata, not evidence for the commit message.
    } else if (line.startsWith('+')) {
      added.push(line);
    } else if (line.startsWith('-')) {
      removed.push(line);
    } else if (line.startsWith('@@')) {
      context.push(line);
    }
  }

  return { added, context, formattingOnly: isLikelyFormattingOnly(added, removed), removed };
};

const renderFileDigest = (file: FileDiff): string => {
  const digest = digestLines(file);
  const priority = priorityOf(file);
  const maxAdded = priority === 'primary' ? MAX_PRIMARY_ADDED_LINES : MAX_SECONDARY_ADDED_LINES;
  const maxRemoved =
    priority === 'primary' ? MAX_PRIMARY_REMOVED_LINES : MAX_SECONDARY_REMOVED_LINES;
  const maxContext =
    priority === 'primary' ? MAX_PRIMARY_CONTEXT_LINES : MAX_SECONDARY_CONTEXT_LINES;
  const sections = [
    summarizeFile(file),
    `priority: ${priority}`,
    digest.formattingOnly
      ? 'note: changed lines normalize to the same content; likely formatting/reflow noise'
      : '',
    formatBlock('Added lines', 'diff', truncateLines(digest.added, maxAdded, 'added')),
    formatBlock(
      'Removed/replaced line evidence',
      'diff',
      truncateLines(digest.removed, maxRemoved, 'removed'),
    ),
    formatBlock('Hunk anchors', 'diff', truncateLines(digest.context, maxContext, 'context')),
  ];
  return sections.filter((section) => section !== '').join('\n\n');
};

const buildChangeOverview = (files: FileDiff[]): string => {
  const rows = files.map((file) => {
    const path = file.oldPath === undefined ? file.path : `${file.oldPath} -> ${file.path}`;
    const priority = priorityOf(file);
    return `- ${priority.padEnd(PRIORITY_COLUMN_WIDTH)} ${file.status.padEnd(STATUS_COLUMN_WIDTH)} +${String(file.additions).padStart(STAT_COLUMN_WIDTH)} -${String(file.deletions).padStart(STAT_COLUMN_WIDTH)} ${path}`;
  });
  return ['## Change Overview', 'priority status   +add -del path', ...rows].join('\n');
};

/**
 * Compress diffs to fit within the input budget reserved for code changes.
 */
const compressDiffs = (files: FileDiff[], options: CompressDiffsOptions = {}): string => {
  const sortedFiles = files.toSorted((a, b) => {
    const priorityDelta = priorityRank(a) - priorityRank(b);
    return priorityDelta === 0
      ? b.additions + b.deletions - (a.additions + a.deletions)
      : priorityDelta;
  });
  const diffs: string[] = [buildChangeOverview(sortedFiles)];
  const estimator = options.estimator ?? estimateTokens;
  let totalTokens = estimator(diffs[0] ?? '');
  const tokenBudget = options.tokenBudget ?? Number.POSITIVE_INFINITY;

  for (const file of sortedFiles) {
    if (file.status === 'deleted') {
      totalTokens = appendWithinBudget(
        diffs,
        summarizeFile(file),
        totalTokens,
        tokenBudget,
        estimator,
      );
    } else {
      const rendered = renderFileDigest(file);
      const renderedTokens = estimator(rendered);
      if (totalTokens + renderedTokens > tokenBudget) {
        totalTokens = appendWithinBudget(
          diffs,
          `${summarizeFile(file)}\npriority: ${priorityOf(file)}\nnote: detailed line digest omitted because the model context budget was exhausted`,
          totalTokens,
          tokenBudget,
          estimator,
        );
      } else {
        totalTokens += renderedTokens;
        diffs.push(rendered);
      }
    }
  }

  return diffs.join('\n\n');
};

export { classifyFiles, compressDiffs, parseUnifiedDiff };
