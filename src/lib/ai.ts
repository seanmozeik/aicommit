import type { GenerateResult, SemanticInfo } from '../types.js';
import type { SecretsConfig } from './config.js';
import { formatSemantics } from './semantic.js';

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

  const model = '@cf/qwen/qwen3-30b-a3b-fp8';
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${cloudflare.accountId}/ai/run/${model}`,
    {
      body: JSON.stringify({
        messages: [{ content: prompt, role: 'user' }]
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
    result?: {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens: number; completion_tokens: number };
    };
  };

  const text = data.result?.choices?.[0]?.message?.content || '';
  const usage = data.result?.usage
    ? {
        input_tokens: data.result.usage.prompt_tokens,
        output_tokens: data.result.usage.completion_tokens
      }
    : undefined;
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
    body: JSON.stringify({
      max_tokens: 256,
      messages: [{ content: prompt, role: 'user' }],
      model: 'claude-haiku-4-5-20251001'
    }),
    headers: {
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
      'x-api-key': anthropic.apiKey
    },
    method: 'POST'
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
    body: JSON.stringify({
      max_tokens: 256,
      messages: [{ content: prompt, role: 'user' }],
      model: 'gpt-4.1-mini'
    }),
    headers: {
      Authorization: `Bearer ${openai.apiKey}`,
      'Content-Type': 'application/json'
    },
    method: 'POST'
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
 * Generate commit message with local model (OpenAI-compatible chat completions)
 */
export async function generateWithLocal(
  prompt: string,
  config: SecretsConfig
): Promise<GenerateResult> {
  const local = config.providers.local;
  if (!local) {
    throw new Error('Local model not configured. Run: aic setup');
  }

  const endpoint = local.endpoint.replace(/\/$/, ''); // Remove trailing slash if present
  const url = `${endpoint}/v1/chat/completions`;

  const response = await fetch(url, {
    body: JSON.stringify({
      max_tokens: 256,
      messages: [{ content: prompt, role: 'user' }],
      model: local.model
    }),
    headers: {
      'Content-Type': 'application/json'
    },
    method: 'POST'
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Local model error: ${error}`);
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

CRITICAL INSTRUCTIONS:
1. Reply with ONLY the commit message itself
2. Do NOT include any explanations, reasoning, or commentary
3. Do NOT start with newlines, blank lines, or whitespace
4. Do NOT use quotes around your response
5. Output must begin immediately with the commit type (e.g., "feat:", "fix:")
6. Your entire output should be exactly one line containing only the commit message`);

  return sections.join('\n\n');
}

/**
 * Validate and clean up generated commit message
 */
export function validateMessage(msg: string): string {
  // Strip all leading whitespace including newlines, then remove code fences
  const cleaned = msg
    .replace(/^\s+/, '')
    .replace(/^```\w*\n?/, '')
    .replace(/\n?```$/, '');

  // Find the first line that looks like a conventional commit
  const conventionalPattern =
    /^(feat|fix|refactor|style|docs|test|build|chore|perf|ci|revert)(\(.+?\))?:/;

  const lines = cleaned.split('\n').map((line) => {
    // Remove leading/trailing quotes and whitespace
    let l = line.trim();
    while (l.startsWith('"') || l.endsWith('"')) {
      l = l.replace(/^"/, '').replace(/"$/, '');
      l = l.trim();
    }
    return l;
  });

  // Filter out empty lines and find the first conventional commit line
  const validLines = lines.filter((line) => line.length > 0);
  const commitLine = validLines.find((line) => conventionalPattern.test(line)) ?? validLines[0];
  return commitLine ? commitLine.trim() : '';
}
