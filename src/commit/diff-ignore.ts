import type { FileDiff, ParsedDiff } from '../domain/types';

const recalculateParsedDiff = (files: FileDiff[]): ParsedDiff => ({
  files,
  totalAdditions: files.reduce((total, file) => total + file.additions, 0),
  totalDeletions: files.reduce((total, file) => total + file.deletions, 0),
});

const ignorePatternMatches = (pattern: string, path: string): boolean => {
  const normalized = pattern.trim().replace(/^\.?\//u, '');
  if (normalized === '') {
    return false;
  }
  if (normalized.endsWith('/')) {
    return path.startsWith(normalized);
  }
  if (normalized.includes('*') || normalized.includes('?')) {
    return new Bun.Glob(normalized).match(path);
  }
  return path === normalized || path.startsWith(`${normalized}/`);
};

const filterIgnoredDiffs = (
  parsed: ParsedDiff,
  ignorePatterns: readonly string[] = [],
): { ignored: FileDiff[]; parsed: ParsedDiff } => {
  const ignored: FileDiff[] = [];
  const kept: FileDiff[] = [];

  for (const file of parsed.files) {
    const paths = file.oldPath === undefined ? [file.path] : [file.path, file.oldPath];
    const isIgnored = ignorePatterns.some((pattern) =>
      paths.some((path) => ignorePatternMatches(pattern, path)),
    );
    if (isIgnored) {
      ignored.push(file);
    } else {
      kept.push(file);
    }
  }

  return { ignored, parsed: recalculateParsedDiff(kept) };
};

export { filterIgnoredDiffs };
