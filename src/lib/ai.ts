import type { GenerateResult, SemanticInfo } from '../types.js';
import { formatSemantics } from './semantic.js';
import type { SecretsConfig } from './config.js';

// Commit type definitions
export const COMMIT_TYPES: Record<string, string> = {
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
 * Generate commit message with Cloudflare AI
 */
export async function generateWithCloudflare(
  prompt: string,
  config: SecretsConfig
): Promise<GenerateResult> {
  const cloudflare = config.providers.cloudflare;
  if (!cloudflare) {
    throw new Error('Cloudflare not configured. Run: aic setup');
  }

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${cloudflare.accountId}/ai/v1/responses`,
    {
      body: JSON.stringify({
        input: prompt,
        model: '@cf/openai/gpt-oss-20b'
      }),
      headers: {
        Authorization: `Bearer ${cloudflare.apiToken}`,
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
 * Generate commit message with Anthropic API
 */
export async function generateWithAnthropic(
  prompt: string,
  config: SecretsConfig
): Promise<GenerateResult> {
  const anthropic = config.providers.anthropic;
  if (!anthropic) {
    throw new Error('Anthropic not configured. Run: aic setup');
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropic.apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-3-haiku-20240307',
      max_tokens: 256,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Anthropic API error: ${error}`);
  }

  const data = (await response.json()) as {
    content?: { type: string; text?: string }[];
    usage?: { input_tokens: number; output_tokens: number };
  };

  const text = data.content?.find((c) => c.type === 'text')?.text || '';
  const usage = data.usage;
  return { text, usage };
}

/**
 * Generate commit message with OpenAI API
 */
export async function generateWithOpenAI(
  prompt: string,
  config: SecretsConfig
): Promise<GenerateResult> {
  const openai = config.providers.openai;
  if (!openai) {
    throw new Error('OpenAI not configured. Run: aic setup');
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openai.apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 256,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${error}`);
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens: number; completion_tokens: number };
  };

  const text = data.choices?.[0]?.message?.content || '';
  const usage = data.usage
    ? { input_tokens: data.usage.prompt_tokens, output_tokens: data.usage.completion_tokens }
    : undefined;
  return { text, usage };
}

/**
 * Build the prompt for AI generation
 */
export function buildPrompt(
  userInput: string,
  stats: string,
  semantics: SemanticInfo,
  fileList: string,
  compressedDiffs: string,
  selectedType?: string,
  recentCommits?: string[]
): string {
  const sections: string[] = ['Generate a conventional commit message.'];

  if (selectedType && selectedType !== 'auto') {
    const typeDesc = COMMIT_TYPES[selectedType] || '';
    sections.push(
      `## User Selection\nThe user indicated this commit is most likely a "${selectedType}" (${typeDesc}).\nUse this type unless absolutely certain another type is more accurate.\nYou can still add a scope in parentheses, e.g., ${selectedType}(scope): description.`
    );
  }

  if (recentCommits && recentCommits.length > 0) {
    const commitList = recentCommits.map((c) => `- ${c}`).join('\n');
    sections.push(
      `## Recent Project Activity\nThese are the most recent commits in this repository, showing what the developer has been working on. Use this context to better understand how the current changes fit into the ongoing work:\n${commitList}`
    );
  }

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
  const withoutCodeFences = msg
    .trim()
    .replace(/^```\w*\n?/, '')
    .replace(/\n?```$/, '');

  // Find the first line that looks like a conventional commit
  const conventionalPattern =
    /^(feat|fix|refactor|style|docs|test|build|chore|perf|ci|revert)(\(.+?\))?:/;

  const lines = withoutCodeFences
    .split('\n')
    .map((line) => line.replace(/^["']|["']$/g, '').trim());

  const commitLine = lines.find((line) => conventionalPattern.test(line)) ?? lines[0];
  return commitLine.trim();
}
