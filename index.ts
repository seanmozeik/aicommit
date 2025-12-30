#!/usr/bin/env bun

import * as p from '@clack/prompts';
import { $ } from 'bun';

// ============================================================================
// Keychain Helper
// ============================================================================

async function getSecret(key: string): Promise<string | null> {
  // 1. Check environment variable first (cross-platform, works on Linux)
  // Key should already include AIC_ prefix (e.g., AIC_CLOUDFLARE_ACCOUNT_ID)
  const envValue = process.env[key];
  if (envValue) {
    return envValue;
  }

  // 2. Try macOS Keychain if on darwin
  if (process.platform === 'darwin') {
    try {
      const proc = Bun.spawn({
        cmd: ['security', 'find-generic-password', '-a', process.env.USER ?? '', '-s', key, '-w'],
        stderr: 'pipe',
        stdout: 'pipe'
      });
      const exitCode = await proc.exited;
      if (exitCode === 0) {
        return (await new Response(proc.stdout).text()).trim();
      }
    } catch {
      // Keychain lookup failed
    }
  }

  return null;
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

const COMMIT_TYPES: Record<string, string> = {
  build: 'Build system or external dependency changes',
  chore: 'Maintenance tasks, no production code change',
  ci: 'CI/CD configuration changes',
  docs: 'Documentation only changes',
  feat: 'A new feature for the user',
  fix: 'A bug fix',
  perf: 'Performance improvements',
  refactor: 'Code restructuring without changing behavior',
  revert: 'Reverting a previous commit',
  style: 'Formatting, whitespace, or style changes',
  test: 'Adding or updating tests'
};

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

  const typeDescriptions = Object.entries(COMMIT_TYPES)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');

  sections.push(`## Commit Types
${typeDescriptions}

## Rules
- Max 72 characters
- Format: type(scope): description OR type: description
- Focus on WHY not WHAT

IMPORTANT: Reply with ONLY the commit message. No explanations, no preamble, no "Here's", no quotes. Just the commit message starting with the type.`);

  return sections.join('\n\n');
}

// ============================================================================
// AI Generation
// ============================================================================

async function generateWithCloudflare(
  prompt: string
): Promise<{ text: string; usage?: { input_tokens: number; output_tokens: number } }> {
  const accountId = await getSecret('AIC_CLOUDFLARE_ACCOUNT_ID');
  const apiToken = await getSecret('AIC_CLOUDFLARE_API_TOKEN');

  if (!accountId || !apiToken) {
    throw new Error('Missing secrets in keychain. Run "just setup" with a .env file first.');
  }

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/responses`,
    {
      body: JSON.stringify({
        input: prompt,
        model: '@cf/openai/gpt-oss-20b'
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

  const data = (await response.json()) as {
    output?: { type: string; content?: { text?: string }[] }[];
    usage?: { input_tokens: number; output_tokens: number };
  };
  // Find the message output (not reasoning) and extract text
  const message = data.output?.find((o) => o.type === 'message');
  const text = message?.content?.[0]?.text || '';
  const usage = data.usage;
  return { text, usage };
}

async function generateWithClaude(
  prompt: string
): Promise<{ text: string; usage?: { input_tokens: number; output_tokens: number } }> {
  const proc = Bun.spawn({
    cmd: ['claude', '--model', 'haiku', '-p', prompt],
    stdout: 'pipe'
  });
  const text = (await new Response(proc.stdout).text()).trim();
  return { text };
}

// ============================================================================
// Clipboard (cross-platform)
// ============================================================================

async function copyToClipboard(text: string): Promise<boolean> {
  if (process.platform === 'darwin') {
    const proc = Bun.spawn(['pbcopy'], { stdin: 'pipe' });
    proc.stdin.write(text);
    proc.stdin.end();
    await proc.exited;
    return true;
  }

  // Linux: try available clipboard tools in order of preference
  const tools: string[][] = [
    ['xclip', '-selection', 'clipboard'],
    ['xsel', '--clipboard', '--input'],
    ['wl-copy'] // Wayland
  ];

  for (const cmd of tools) {
    try {
      const which = await $`which ${cmd[0]}`.quiet();
      if (which.exitCode === 0) {
        const proc = Bun.spawn(cmd, { stdin: 'pipe' });
        proc.stdin.write(text);
        proc.stdin.end();
        await proc.exited;
        return true;
      }
    } catch {
      // Tool not found, try next
    }
  }

  return false;
}

// ============================================================================
// Validation
// ============================================================================

function validateMessage(msg: string): string {
  let cleaned = msg.trim();
  cleaned = cleaned.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');

  // Find the first line that looks like a conventional commit
  const conventionalPattern =
    /^(feat|fix|refactor|style|docs|test|build|chore|perf|ci|revert)(\(.+?\))?:/;
  const lines = cleaned.split('\n').map((l) => l.replace(/^["']|["']$/g, '').trim());
  const commitLine = lines.find((l) => conventionalPattern.test(l)) || lines[0];

  let result = commitLine.trim();
  if (result.length > 72) result = `${result.slice(0, 69)}...`;
  return result;
}

// ============================================================================
// Main
// ============================================================================

(async () => {
  p.intro('aic');

  // Check if we're in a git repo
  let stagedCheck: string;
  try {
    stagedCheck = (await $`git diff --cached --name-only`.text()).trim();
  } catch {
    p.outro('Not a git repository');
    process.exit(1);
  }
  let hasStaged = stagedCheck.length > 0;

  // Check if HEAD exists (false for initial commit)
  let hasHead = true;
  try {
    await $`git rev-parse HEAD`.quiet();
  } catch {
    hasHead = false;
  }

  // If no files staged and we have HEAD, offer file selection
  if (!hasStaged && hasHead) {
    // Get submodule paths to exclude from staging options
    const submodulePaths = new Set<string>();
    try {
      const submoduleOutput = (
        await $`git config --file .gitmodules --get-regexp path`.quiet()
      ).text();
      for (const line of submoduleOutput.split('\n').filter(Boolean)) {
        const match = line.match(/submodule\..*\.path\s+(.+)/);
        if (match) submodulePaths.add(match[1]);
      }
    } catch {
      // No .gitmodules or no submodules configured
    }

    let statusOutput: string;
    try {
      statusOutput = (await $`git status --porcelain`.text()).trim();
    } catch {
      p.log.warn('Failed to get git status');
      statusOutput = '';
    }
    const changedFiles = statusOutput
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const status = line.slice(0, 2);
        const path = line.slice(2).trimStart();
        // Status codes: M=modified, A=added, D=deleted, ??=untracked
        const isUntracked = status === '??';
        const isModified = status.includes('M');
        const isDeleted = status.includes('D');
        return {
          hint: isUntracked
            ? 'new'
            : isModified
              ? 'modified'
              : isDeleted
                ? 'deleted'
                : status.trim(),
          path,
          status
        };
      })
      .filter((f) => !submodulePaths.has(f.path));

    if (changedFiles.length > 0 && changedFiles.length <= 15) {
      const selected = await p.multiselect({
        message: 'Select files to stage:',
        options: [
          { hint: 'generate from all changes', label: 'Skip', value: '__skip__' },
          ...changedFiles.map((f) => ({
            hint: f.hint,
            label: f.path,
            value: f.path
          }))
        ]
      });

      if (p.isCancel(selected)) {
        p.outro('Cancelled');
        process.exit(0);
      }

      const filesToStage = (selected as string[]).filter((f) => f !== '__skip__');
      if (filesToStage.length > 0) {
        try {
          await $`git add ${filesToStage}`;
          hasStaged = true;
        } catch (err) {
          p.log.error(`Failed to stage files: ${err instanceof Error ? err.message : err}`);
          p.outro('Aborted');
          process.exit(1);
        }
      }
    }
  }

  const userInput = await p.text({
    defaultValue: '',
    message: 'Describe your changes (optional):'
  });

  if (p.isCancel(userInput)) {
    p.outro('Cancelled');
    process.exit(0);
  }

  // Single git call - get everything at once
  let diffOutput: string;
  try {
    if (hasStaged) {
      p.log.info('Using staged files only');
      diffOutput = await $`git diff --cached --diff-algorithm=minimal`.text();
    } else if (!hasHead) {
      p.outro('Initial commit: stage files first with "git add"');
      process.exit(0);
    } else {
      diffOutput = await $`git diff HEAD --diff-algorithm=minimal`.text();
    }
  } catch (err) {
    p.log.error(`Failed to get diff: ${err instanceof Error ? err.message : err}`);
    p.outro('Aborted');
    process.exit(1);
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
    const response =
      model === 'claude' ? await generateWithClaude(prompt) : await generateWithCloudflare(prompt);
    commitMessage = validateMessage(response.text);
    const usage = response.usage;
    if (usage) {
      const neurons = Math.round(usage.input_tokens * 0.018182 + usage.output_tokens * 0.027273);
      s.stop(`Done (in: ${usage.input_tokens}, out: ${usage.output_tokens}, ~${neurons} neurons)`);
    } else {
      s.stop('Done');
    }
  } catch (err) {
    s.stop('Failed');
    p.log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  // Display the message
  p.note(commitMessage, 'Commit Message');

  // Action menu
  let finalMessage = commitMessage;

  while (true) {
    const action = await p.select({
      message: 'What would you like to do?',
      options: [
        ...(hasStaged ? [{ hint: 'staged files', label: 'Commit', value: 'commit' }] : []),
        { hint: 'modify the message', label: 'Edit', value: 'edit' },
        { label: 'Copy to clipboard', value: 'copy' },
        { label: 'Cancel', value: 'cancel' }
      ]
    });

    if (p.isCancel(action) || action === 'cancel') {
      p.outro('Done');
      process.exit(0);
    }

    if (action === 'edit') {
      const edited = await p.text({
        initialValue: finalMessage,
        message: 'Edit commit message:'
      });

      if (p.isCancel(edited)) continue;
      finalMessage = edited as string;
      p.note(finalMessage, 'Commit Message');
      continue;
    }

    if (action === 'commit') {
      try {
        await $`git commit -m ${finalMessage}`.quiet();
      } catch (err) {
        p.log.error(`Commit failed: ${err instanceof Error ? err.message : err}`);
        p.outro('Aborted');
        process.exit(1);
      }

      const shouldPush = await p.confirm({ message: 'Push to remote?' });

      if (p.isCancel(shouldPush) || !shouldPush) {
        p.outro('Committed!');
        process.exit(0);
      }

      try {
        await $`git push`;
      } catch (err) {
        p.log.error(`Push failed: ${err instanceof Error ? err.message : err}`);
        p.outro('Committed locally, but push failed');
        process.exit(1);
      }
      p.outro('Committed and pushed!');
      process.exit(0);
    }

    if (action === 'copy') {
      const copied = await copyToClipboard(finalMessage);
      if (copied) {
        p.outro('Copied to clipboard!');
      } else {
        p.log.warn('No clipboard tool found. Install xclip, xsel, or wl-copy.');
        p.outro(finalMessage);
      }
      process.exit(0);
    }
  }
})();
