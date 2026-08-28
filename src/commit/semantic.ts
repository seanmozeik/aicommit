import type { ClassifiedFiles, FileDiff, SemanticInfo } from '../domain/types';

const MAX_FUNCTIONS_TO_DISPLAY = 10;
const MAX_OTHER_TO_DISPLAY = 5;

/**
 * Extract added lines from a diff (lines starting with +)
 */
const extractAddedCode = (diff: string): string =>
  diff
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1))
    .join('\n');

/**
 * Extract semantic information from diffs using regex patterns
 */
export const extractSemantics = (files: FileDiff[]): SemanticInfo => {
  const allAddedCode = files
    .filter((file) => file.status !== 'deleted')
    .map((file) => extractAddedCode(file.diff))
    .join('\n');
  const namesForPattern = (pattern: RegExp): string[] =>
    [...allAddedCode.matchAll(pattern)].flatMap(({ groups }) => {
      const name = groups?.['name'];
      return name === undefined ? [] : [name];
    });

  const functions = [
    ...namesForPattern(/(?:function|async function)\s+(?<name>\w+)\s*\(/gu),
    ...namesForPattern(/(?:const|let|var)\s+(?<name>\w+)\s*=\s*(?:async\s*)?\(/gu),
    ...namesForPattern(/(?:const|let|var)\s+(?<name>\w+)\s*=\s*(?:async\s*)?\w*\s*=>/gu),
  ];
  const types = namesForPattern(/(?:interface|type)\s+(?<name>\w+)/gu);
  const classes = namesForPattern(/class\s+(?<name>\w+)/gu);
  const exports = namesForPattern(
    /export\s+(?:default\s+)?(?:function|const|class|interface|type|async function)\s+(?<name>\w+)/gu,
  );

  return {
    classes: [...new Set(classes)],
    exports: [...new Set(exports)],
    functions: [...new Set(functions)],
    types: [...new Set(types)],
  };
};

/**
 * Format semantic info for display/prompt
 */
export const formatSemantics = (semantics: SemanticInfo): string => {
  const parts: string[] = [];
  if (semantics.functions.length > 0) {
    parts.push(`Functions: ${semantics.functions.slice(0, MAX_FUNCTIONS_TO_DISPLAY).join(', ')}`);
  }
  if (semantics.classes.length > 0) {
    parts.push(`Classes: ${semantics.classes.slice(0, MAX_OTHER_TO_DISPLAY).join(', ')}`);
  }
  if (semantics.types.length > 0) {
    parts.push(`Types: ${semantics.types.slice(0, MAX_OTHER_TO_DISPLAY).join(', ')}`);
  }
  if (semantics.exports.length > 0) {
    parts.push(`Exports: ${semantics.exports.slice(0, MAX_OTHER_TO_DISPLAY).join(', ')}`);
  }
  return parts.join('\n');
};

/**
 * Format file stats for display/prompt
 */
export const formatStats = (
  files: ClassifiedFiles,
  totalAdditions: number,
  totalDeletions: number,
): string => {
  const counts: string[] = [];
  const added = files.included.filter((file) => file.status === 'added').length;
  const modified = files.included.filter((file) => file.status === 'modified').length;
  const deleted = files.included.filter((file) => file.status === 'deleted').length;
  const renamed = files.included.filter((file) => file.status === 'renamed').length;

  if (modified > 0) {
    counts.push(`${modified} modified`);
  }
  if (added > 0) {
    counts.push(`${added} added`);
  }
  if (deleted > 0) {
    counts.push(`${deleted} deleted`);
  }
  if (renamed > 0) {
    counts.push(`${renamed} renamed`);
  }

  return `Files: ${counts.join(', ')} | Lines: +${totalAdditions} / -${totalDeletions}`;
};
