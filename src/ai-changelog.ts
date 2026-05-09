import { Effect } from 'effect';

import type { Preset } from './secrets';

const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_CONTEXT_WINDOW = 32_000;
const OUTPUT_CONTEXT_FRACTION = 0.1;
const MIN_OUTPUT_TOKENS = 64;
const BAD_REQUEST_STATUS = 400;

const SUBMIT_CHANGELOG_TOOL = {
  function: {
    description: 'Submit the final Keep a Changelog markdown body for one release.',
    name: 'SubmitChangelog',
    parameters: {
      additionalProperties: false,
      properties: {
        markdown: {
          description:
            'Markdown body containing only Keep a Changelog sections such as Added, Changed, Fixed, and Removed.',
          type: 'string',
        },
      },
      required: ['markdown'],
      type: 'object',
    },
  },
  type: 'function',
} as const;

const CHANGELOG_SYSTEM_PROMPT =
  'You write concise Keep a Changelog release notes. Do not include the version heading or date. Use the SubmitChangelog tool only.';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const maxOutputTokens = (preset: Preset): number =>
  Math.max(
    MIN_OUTPUT_TOKENS,
    Math.floor((preset.contextWindow ?? DEFAULT_CONTEXT_WINDOW) * OUTPUT_CONTEXT_FRACTION),
  );

const buildChangelogRequest = (
  prompt: string,
  preset: Preset,
  options: { readonly reasoningControls?: boolean } = {},
): { apiUrl: string; body: string; headers: Record<string, string> } => {
  const cleanBaseUrl = preset.baseUrl.replace(/\/$/u, '');
  const apiUrl = preset.baseUrl.includes('/chat/completions')
    ? preset.baseUrl
    : `${cleanBaseUrl}/v1/chat/completions`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (preset.apiKey !== undefined && preset.apiKey !== '') {
    headers['Authorization'] = `Bearer ${preset.apiKey}`;
  }
  const body = JSON.stringify({
    ...(options.reasoningControls === true
      ? {
          chat_template_kwargs: { enable_thinking: false },
          reasoning: { effort: 'none', enabled: false, exclude: true },
          reasoning_effort: 'none',
        }
      : {}),
    max_tokens: maxOutputTokens(preset),
    messages: [
      { content: CHANGELOG_SYSTEM_PROMPT, role: 'system' },
      { content: prompt, role: 'user' },
    ],
    model: preset.model,
    tool_choice: { function: { name: SUBMIT_CHANGELOG_TOOL.function.name }, type: 'function' },
    tools: [SUBMIT_CHANGELOG_TOOL],
  });
  return { apiUrl, body, headers };
};

const fetchChangelogResponse = (request: {
  readonly apiUrl: string;
  readonly body: string;
  readonly headers: Record<string, string>;
}): Effect.Effect<Response> =>
  Effect.tryPromise(() =>
    fetch(request.apiUrl, {
      body: request.body,
      headers: request.headers,
      method: 'POST',
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
    }),
  );

const extractChangelogMarkdown = async (response: Response): Promise<string> => {
  if (!response.ok) {
    throw new Error(`Changelog API request failed: ${response.status}`);
  }
  const json: unknown = await response.json();
  if (!isRecord(json) || !Array.isArray(json['choices'])) {
    throw new Error('Invalid changelog API response');
  }
  const { choices }: { readonly choices: unknown[] } = { choices: json['choices'] };
  const [choice] = choices;
  const message = isRecord(choice) ? choice['message'] : undefined;
  const toolCalls: unknown[] =
    isRecord(message) && Array.isArray(message['tool_calls']) ? message['tool_calls'] : [];
  const toolCall = toolCalls.find(
    (call) =>
      isRecord(call) &&
      isRecord(call['function']) &&
      call['function']['name'] === SUBMIT_CHANGELOG_TOOL.function.name,
  );
  const args =
    isRecord(toolCall) && isRecord(toolCall['function'])
      ? toolCall['function']['arguments']
      : undefined;
  if (typeof args !== 'string' || args.trim() === '') {
    throw new Error('Changelog model did not call SubmitChangelog');
  }
  const parsed: unknown = JSON.parse(args);
  if (!isRecord(parsed) || typeof parsed['markdown'] !== 'string') {
    throw new Error('Invalid SubmitChangelog payload');
  }
  return parsed['markdown'].trim();
};

export const generateChangelogWithOpenAICompatible = (
  prompt: string,
  preset: Preset,
): Effect.Effect<string, unknown> =>
  Effect.gen(function* generateChangelogWithOpenAICompatibleGen() {
    let response = yield* fetchChangelogResponse(
      buildChangelogRequest(prompt, preset, { reasoningControls: true }),
    );
    if (response.status === BAD_REQUEST_STATUS) {
      response = yield* fetchChangelogResponse(buildChangelogRequest(prompt, preset));
    }
    return yield* Effect.tryPromise(() => extractChangelogMarkdown(response));
  });
