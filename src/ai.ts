import { Effect } from 'effect';

import { generateWithCodex } from './ai-codex';
import { COMMIT_TYPES } from './commit-types';
import type { ApiResponseError as ApiResponseErrorClass } from './errors/index';
import {
  ClaudeCliError as ClaudeCliErrorClass,
  OpenAiApiError as OpenAiApiErrorClass,
} from './errors/index.js';
import { buildPrompt, buildSystemPrompt } from './prompt';
import type { Preset } from './secrets';
import { estimateTokens } from './tokenizer';
import { validateMessage } from './validation';
const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_CONTEXT_WINDOW = 32_000;
const INPUT_CONTEXT_FRACTION = 0.25;
const OUTPUT_CONTEXT_FRACTION = 0.05;
const MIN_INPUT_TOKENS = 1000;
const MIN_OUTPUT_TOKENS = 64;
const BAD_REQUEST_STATUS = 400;

const SUBMIT_COMMIT_MESSAGE_TOOL = {
  function: {
    description: 'Submit the final one-line conventional commit message.',
    name: 'SubmitCommitMessage',
    parameters: {
      additionalProperties: false,
      properties: {
        message: {
          description: 'A single conventional commit subject, at most 72 characters.',
          type: 'string',
        },
      },
      required: ['message'],
      type: 'object',
    },
  },
  type: 'function',
} as const;

interface ModelBudgets {
  readonly contextWindow: number;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
}

const getModelBudgets = (
  preset: Preset | null,
  options: { readonly outputContextFraction?: number } = {},
): ModelBudgets => {
  const contextWindow = preset?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
  return {
    contextWindow,
    maxInputTokens: Math.max(MIN_INPUT_TOKENS, Math.floor(contextWindow * INPUT_CONTEXT_FRACTION)),
    maxOutputTokens: Math.max(
      MIN_OUTPUT_TOKENS,
      Math.floor(contextWindow * (options.outputContextFraction ?? OUTPUT_CONTEXT_FRACTION)),
    ),
  };
};
const generateWithClaude = (prompt: string): Effect.Effect<string, ClaudeCliErrorClass> =>
  Effect.gen(function* generateWithClaudeGen() {
    const proc = Bun.spawn(['claude', '--model', 'haiku', '-p', prompt], {
      stderr: 'pipe',
      stdout: 'pipe',
    });
    const exitCode = yield* Effect.tryPromise({
      catch: (error) =>
        new ClaudeCliErrorClass({
          exitCode: -1,
          message: `Failed to get exit code: ${error instanceof Error ? error.message : JSON.stringify(error)}`,
        }),
      try: () => proc.exited,
    });
    if (exitCode !== 0) {
      const stderr = yield* Effect.promise(async () => {
        try {
          return await new Response(proc.stderr).text();
        } catch {
          return '';
        }
      });
      return yield* new ClaudeCliErrorClass({
        exitCode,
        message: stderr.trim() || `Claude CLI exited with code ${exitCode}`,
      });
    }
    const text = yield* Effect.tryPromise({
      catch: (error) =>
        new ClaudeCliErrorClass({
          exitCode,
          message: `Failed to read stdout: ${error instanceof Error ? error.message : JSON.stringify(error)}`,
        }),
      try: () => new Response(proc.stdout).text(),
    });
    const trimmed = text.trim();
    return trimmed;
  });
const buildApiRequest = (
  prompt: string,
  preset: Preset,
  options: {
    readonly maxOutputContextFraction?: number;
    readonly reasoningControls?: boolean;
    readonly systemPrompt?: string;
    readonly tool?: typeof SUBMIT_COMMIT_MESSAGE_TOOL;
  } = {},
): { apiUrl: string; body: string; headers: Record<string, string> } => {
  const cleanBaseUrl = preset.baseUrl.replace(/\/$/u, '');
  const apiUrl = preset.baseUrl.includes('/chat/completions')
    ? preset.baseUrl
    : `${cleanBaseUrl}/v1/chat/completions`;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (preset.apiKey !== undefined && preset.apiKey !== '') {
    headers['Authorization'] = `Bearer ${preset.apiKey}`;
  }

  const tool = options.tool ?? SUBMIT_COMMIT_MESSAGE_TOOL;
  const budgets = getModelBudgets(preset, {
    outputContextFraction: options.maxOutputContextFraction,
  });

  const body = JSON.stringify({
    ...(options.reasoningControls === true
      ? {
          chat_template_kwargs: { enable_thinking: false },
          reasoning: { effort: 'none', enabled: false, exclude: true },
          reasoning_effort: 'none',
        }
      : {}),
    max_tokens: budgets.maxOutputTokens,
    messages: [
      { content: options.systemPrompt ?? buildSystemPrompt(), role: 'system' },
      { content: prompt, role: 'user' },
    ],
    model: preset.model,
    tool_choice: { function: { name: tool.function.name }, type: 'function' },
    tools: [tool],
  });

  return { apiUrl, body, headers };
};

const fetchApiResponse = (request: {
  apiUrl: string;
  body: string;
  headers: Record<string, string>;
}): Effect.Effect<Response, OpenAiApiErrorClass> =>
  Effect.tryPromise({
    catch: (error) =>
      new OpenAiApiErrorClass({
        error,
        message: `Failed to fetch from ${request.apiUrl}`,
        statusCode: 0,
      }),
    try: () =>
      fetch(request.apiUrl, {
        body: request.body,
        headers: request.headers,
        method: 'POST',
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
      }),
  });

interface OpenAiMessage {
  content?: string;
  tool_calls?: { function?: { arguments?: string; name?: string } }[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isOpenAiMessage = (value: unknown): value is OpenAiMessage => {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value['content'] === 'string' ||
    ('tool_calls' in value && Array.isArray(value['tool_calls']))
  );
};

const validateOpenAiResponse = (json: unknown): { choices: { message: OpenAiMessage }[] } => {
  if (
    !isRecord(json) ||
    !('choices' in json) ||
    !Array.isArray(json['choices']) ||
    json['choices'].length === 0
  ) {
    throw new Error('Invalid API response structure');
  }

  const choices = json['choices'] as unknown[];
  const [firstChoice] = choices;
  const { message } = isRecord(firstChoice) ? firstChoice : { message: undefined };
  if (!isOpenAiMessage(message)) {
    throw new Error('Invalid API response structure');
  }

  return { choices: [{ message }] };
};

const extractToolField = (
  toolCalls: { function?: { arguments?: string; name?: string } }[] | undefined,
  toolName: string,
  fieldName: string,
): string | null => {
  const call = toolCalls?.find((toolCall) => toolCall.function?.name === toolName);
  const args = call?.function?.arguments;
  if (args === undefined || args.trim() === '') {
    return null;
  }
  const parsed: unknown = JSON.parse(args);
  if (isRecord(parsed) && typeof parsed[fieldName] === 'string') {
    return parsed[fieldName].trim();
  }
  return null;
};

const parseApiResponse = (
  response: Response,
  options: { readonly toolField?: string; readonly toolName?: string } = {},
): Effect.Effect<{ content: string }, OpenAiApiErrorClass | ApiResponseErrorClass> =>
  Effect.gen(function* parseApiResponseGen() {
    if (!response.ok) {
      return yield* new OpenAiApiErrorClass({
        error: new Error(`API request failed: ${response.status}`),
        message: `API request failed: ${response.status}`,
        statusCode: response.status,
      });
    }

    const data = yield* Effect.tryPromise({
      catch: (error) =>
        new OpenAiApiErrorClass({
          error,
          message: 'Failed to parse API response',
          statusCode: response.status,
        }),
      try: async () => {
        const json: unknown = await response.json();
        return validateOpenAiResponse(json);
      },
    });

    const { content, tool_calls: toolCalls } = data.choices[0].message;
    const toolMessage = yield* Effect.try({
      catch: (error) =>
        new OpenAiApiErrorClass({
          error,
          message: `Failed to parse ${options.toolName ?? 'SubmitCommitMessage'} tool call`,
          statusCode: response.status,
        }),
      try: () =>
        extractToolField(
          toolCalls,
          options.toolName ?? SUBMIT_COMMIT_MESSAGE_TOOL.function.name,
          options.toolField ?? 'message',
        ),
    });

    return { content: (toolMessage ?? content ?? '').trim() };
  });

const generateWithOpenAICompatible = (
  prompt: string,
  preset: Preset,
): Effect.Effect<string, OpenAiApiErrorClass | ApiResponseErrorClass> =>
  Effect.gen(function* generateWithOpenAICompatibleGen() {
    const request = buildApiRequest(prompt, preset, { reasoningControls: true });
    let response = yield* fetchApiResponse(request);
    if (response.status === BAD_REQUEST_STATUS) {
      response = yield* fetchApiResponse(buildApiRequest(prompt, preset));
    }
    const { content } = yield* parseApiResponse(response);
    return content;
  });

export { COMMIT_TYPES, buildPrompt, estimateTokens, generateWithClaude, generateWithCodex };
export { generateWithOpenAICompatible, getModelBudgets, validateMessage };
export type { ModelBudgets };
export type { Preset } from './secrets.js';
