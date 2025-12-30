import type { ClassifiedFiles, FileDiff, SemanticInfo } from '../types.js';

/**
 * Extract added lines from a diff (lines starting with +)
 */
function extractAddedCode(diff: string): string {
  return diff
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1))
    .join('\n');
}

/**
 * Extract semantic information from diffs using regex patterns
 */
export function extractSemantics(files: FileDiff[]): SemanticInfo {
  const allAddedCode = files
    .filter((f) => f.status !== 'deleted')
    .map((f) => extractAddedCode(f.diff))
    .join('\n');

  // Fast regex extraction
  const functions = [
    ...allAddedCode.matchAll(/(?:function|async function)\s+(\w+)\s*\(/g),
    ...allAddedCode.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/g),
    ...allAddedCode.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\w*\s*=>/g)
  ].map((m) => m[1]);

  const types = [...allAddedCode.matchAll(/(?:interface|type)\s+(\w+)/g)].map((m) => m[1]);

  const classes = [...allAddedCode.matchAll(/class\s+(\w+)/g)].map((m) => m[1]);

  const exports = [
    ...allAddedCode.matchAll(
      /export\s+(?:default\s+)?(?:function|const|class|interface|type|async function)\s+(\w+)/g
    )
  ].map((m) => m[1]);

  return {
    classes: [...new Set(classes)],
    exports: [...new Set(exports)],
    functions: [...new Set(functions)],
    types: [...new Set(types)]
  };
}

/**
 * Format semantic info for display/prompt
 */
export function formatSemantics(semantics: SemanticInfo): string {
  const parts: string[] = [];
  if (semantics.functions.length > 0)
    parts.push(`Functions: ${semantics.functions.slice(0, 10).join(', ')}`);
  if (semantics.classes.length > 0)
    parts.push(`Classes: ${semantics.classes.slice(0, 5).join(', ')}`);
  if (semantics.types.length > 0) parts.push(`Types: ${semantics.types.slice(0, 5).join(', ')}`);
  if (semantics.exports.length > 0)
    parts.push(`Exports: ${semantics.exports.slice(0, 5).join(', ')}`);
  return parts.join('\n');
}

/**
 * Format file stats for display/prompt
 */
export function formatStats(
  files: ClassifiedFiles,
  totalAdditions: number,
  totalDeletions: number
): string {
  const counts: string[] = [];
  const added = files.included.filter((f) => f.status === 'added').length;
  const modified = files.included.filter((f) => f.status === 'modified').length;
  const deleted = files.included.filter((f) => f.status === 'deleted').length;
  const renamed = files.included.filter((f) => f.status === 'renamed').length;

  if (modified > 0) counts.push(`${modified} modified`);
  if (added > 0) counts.push(`${added} added`);
  if (deleted > 0) counts.push(`${deleted} deleted`);
  if (renamed > 0) counts.push(`${renamed} renamed`);

  return `Files: ${counts.join(', ')} | Lines: +${totalAdditions} / -${totalDeletions}`;
}
