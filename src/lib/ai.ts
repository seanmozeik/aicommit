import type { GenerateResult, SemanticInfo } from '../types.js';
import { formatSemantics } from './semantic.js';

// Commit type definitions
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

/**
 * Get secret from environment or macOS Keychain
 */
async function getSecret(key: string): Promise<string | null> {
  // 1. Check environment variable first
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

/**
 * Generate commit message with Cloudflare AI
 */
export async function generateWithCloudflare(prompt: string): Promise<GenerateResult> {
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

  const message = data.output?.find((o) => o.type === 'message');
  const text = message?.content?.[0]?.text || '';
  const usage = data.usage;
  return { text, usage };
}

/**
 * Generate commit message with Claude CLI
 */
export async function generateWithClaude(prompt: string): Promise<GenerateResult> {
  const proc = Bun.spawn({
    cmd: ['claude', '--model', 'haiku', '-p', prompt],
    stdout: 'pipe'
  });
  const text = (await new Response(proc.stdout).text()).trim();
  return { text };
}

/**
 * Build the prompt for AI generation
 */
export function buildPrompt(
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

/**
 * Validate and clean up generated commit message
 */
export function validateMessage(msg: string): string {
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
