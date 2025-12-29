#!/usr/bin/env bun

import * as p from '@clack/prompts';
import { $ } from 'bun';

// ============================================================================
// Keychain Helper
// ============================================================================

async function getSecret(key: string): Promise<string | null> {
  try {
    const result =
      await $`security find-generic-password -a ${process.env.USER} -s aic-${key} -w`.quiet();
    return result.text().trim();
  } catch {
    return null;
  }
}

// ============================================================================
// CLI Arguments
// ============================================================================

const args = Bun.argv.slice(2);
const modelIndex = args.indexOf('--model');
const model = modelIndex !== -1 ? args[modelIndex + 1] : 'cloudflare';

if (model !== 'cloudflare' && model !== 'claude') {
  console.error('Invalid --model. Use "cloudflare" (default) or "claude"');
  process.exit(1);
}

// ============================================================================
// Configuration
// ============================================================================

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

const SUMMARY_ONLY_PATTERNS: RegExp[] = [];

const MAX_LINES_PER_FILE = 50;
const MAX_TOTAL_DIFF_LINES = 1500;

// ============================================================================
// Types
// ============================================================================

interface FileDiff {
  path: string;
  oldPath?: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  diff: string;
  additions: number;
  deletions: number;
}

interface ParsedDiff {
  files: FileDiff[];
  totalAdditions: number;
  totalDeletions: number;
}

interface SemanticInfo {
  functions: string[];
  types: string[];
  exports: string[];
  classes: string[];
}

// ============================================================================
// Single Git Call + Unified Diff Parser
// ============================================================================

function parseUnifiedDiff(diffOutput: string): ParsedDiff {
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

// ============================================================================
// File Classification
// ============================================================================

function classifyFiles(files: FileDiff[]): {
  included: FileDiff[];
  summarized: FileDiff[];
  excluded: FileDiff[];
} {
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

// ============================================================================
// Diff Compression
// ============================================================================

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

function compressDiffs(files: FileDiff[]): string {
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

// ============================================================================
// Fast Regex-Based Semantic Extraction
// ============================================================================

function extractAddedCode(diff: string): string {
  return diff
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1))
    .join('\n');
}

function extractSemantics(files: FileDiff[]): SemanticInfo {
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

// ============================================================================
// Prompt Building
// ============================================================================

function formatStats(
  files: { included: FileDiff[]; summarized: FileDiff[]; excluded: FileDiff[] },
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

function formatSemantics(semantics: SemanticInfo): string {
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

function buildPrompt(
  userInput: string,
  stats: string,
  semantics: SemanticInfo,
  fileList: string,
  compressedDiffs: string
): string {
  const sections: string[] = ['Generate a conventional commit message.'];

  if (userInput?.trim()) {
    sections.push(`## User Note\n${userInput.trim()}`);
  }

  sections.push(`## Stats\n${stats}`);

  const sem = formatSemantics(semantics);
  if (sem) sections.push(`## Code Changes\n${sem}`);

  if (fileList) sections.push(`## Files\n${fileList}`);

  if (compressedDiffs) sections.push(`## Diff\n${compressedDiffs}`);

  sections.push(`## Rules
- Type: feat|fix|refactor|style|docs|test|build|chore|perf|ci|revert
- Max 72 characters
- Format: type(scope): description OR type: description
- Focus on WHY not WHAT
- Output ONLY the commit message, no quotes or markdown`);

  return sections.join('\n\n');
}

// ============================================================================
// AI Generation
// ============================================================================

async function generateWithCloudflare(prompt: string): Promise<string> {
  const accountId = await getSecret('CLOUDFLARE_ACCOUNT_ID');
  const apiToken = await getSecret('CLOUDFLARE_API_TOKEN');

  if (!accountId || !apiToken) {
    throw new Error('Missing secrets in keychain. Run "just setup" with a .env file first.');
  }

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/meta/llama-3.1-8b-instruct`,
    {
      body: JSON.stringify({
        messages: [{ content: prompt, role: 'user' }]
      }),
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
      },
      method: 'POST'
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Cloudflare API error: ${error}`);
  }

  const data = (await response.json()) as { result?: { response?: string } };
  return data.result?.response || '';
}

async function generateWithClaude(prompt: string): Promise<string> {
  const proc = Bun.spawn({
    cmd: ['claude', '--model', 'haiku', '-p', prompt],
    stdout: 'pipe'
  });
  return (await new Response(proc.stdout).text()).trim();
}

// ============================================================================
// Validation
// ============================================================================

function validateMessage(msg: string): string {
  let cleaned = msg.trim();
  cleaned = cleaned.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
  cleaned = cleaned.replace(/^["']|["']$/g, '');
  if (cleaned.length > 72) cleaned = `${cleaned.slice(0, 69)}...`;
  return cleaned.trim();
}

// ============================================================================
// Main
// ============================================================================

(async () => {
  p.intro('aic');

  const userInput = await p.text({
    defaultValue: '',
    message: 'Describe your changes (optional):'
  });

  if (p.isCancel(userInput)) {
    p.outro('Cancelled');
    process.exit(0);
  }

  // Check if there are staged files first
  const stagedCheck = (await $`git diff --cached --name-only`.text()).trim();
  const hasStaged = stagedCheck.length > 0;

  // Check if HEAD exists (false for initial commit)
  let hasHead = true;
  try {
    await $`git rev-parse HEAD`.quiet();
  } catch {
    hasHead = false;
  }

  // Single git call - get everything at once
  let diffOutput: string;
  if (hasStaged) {
    p.log.info('Using staged files only');
    diffOutput = await $`git diff --cached`.text();
  } else if (!hasHead) {
    p.outro('Initial commit: stage files first with "git add"');
    process.exit(0);
  } else {
    diffOutput = await $`git diff HEAD`.text();
  }

  if (!diffOutput.trim()) {
    p.outro('No changes to commit');
    process.exit(0);
  }

  // Parse the unified diff
  const parsed = parseUnifiedDiff(diffOutput);
  const { included, summarized, excluded } = classifyFiles(parsed.files);

  if (included.length === 0 && summarized.length === 0) {
    p.outro('No relevant changes (all files excluded)');
    process.exit(0);
  }

  // Build file list
  const fileList: string[] = [];
  if (included.length > 0) fileList.push(included.map((f) => f.path).join(', '));
  if (summarized.length > 0)
    fileList.push(`(summarized: ${summarized.map((f) => f.path).join(', ')})`);
  if (excluded.length > 0) fileList.push(`(excluded: ${excluded.length} files)`);

  // Extract semantics and compress diffs
  const semantics = extractSemantics(included);
  const compressedDiffs = compressDiffs(included);
  const stats = formatStats(
    { excluded, included, summarized },
    parsed.totalAdditions,
    parsed.totalDeletions
  );

  // Build prompt
  const prompt = buildPrompt(
    userInput || '',
    stats,
    semantics,
    fileList.join('\n'),
    compressedDiffs
  );

  // Generate message with spinner
  const s = p.spinner();
  s.start(`Generating with ${model}...`);

  let commitMessage: string;
  try {
    const rawResponse =
      model === 'claude' ? await generateWithClaude(prompt) : await generateWithCloudflare(prompt);
    commitMessage = validateMessage(rawResponse);
    s.stop('Done');
  } catch (err) {
    s.stop('Failed');
    p.log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  // Display the message
  p.note(commitMessage, 'Commit Message');

  // Commit or copy
  if (hasStaged) {
    const shouldCommit = await p.confirm({ message: 'Commit staged files with this message?' });

    if (p.isCancel(shouldCommit)) {
      p.outro('Cancelled');
      process.exit(0);
    }

    if (shouldCommit) {
      await $`git commit -m ${commitMessage}`;
      p.outro('Committed!');
      process.exit(0);
    }
  }

  const shouldCopy = await p.confirm({ message: 'Copy to clipboard?' });

  if (p.isCancel(shouldCopy)) {
    p.outro('Done');
    process.exit(0);
  }

  if (shouldCopy) {
    const isMac = process.platform === 'darwin';
    const clipboardCmd = isMac ? ['pbcopy'] : ['xclip', '-selection', 'clipboard'];

    const proc = Bun.spawn(clipboardCmd, { stdin: 'pipe' });
    proc.stdin.write(commitMessage);
    proc.stdin.flush();
    proc.stdin.end();
    p.outro('Copied to clipboard!');
  } else {
    p.outro('Done');
  }
})();
