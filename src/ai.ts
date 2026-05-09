import { Effect } from 'effect';

import { COMMIT_TYPES } from './commit-types.js';
import {
  ApiResponseError as ApiResponseErrorClass,
  ClaudeCliError as ClaudeCliErrorClass,
  OpenAiApiError as OpenAiApiErrorClass,
} from './errors/index.js';
import { buildPrompt } from './prompt.js';
import type { Preset } from './secrets.js';
import { validateMessage } from './validation.js';

// Default AI configuration
const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_MAX_TOKENS = 256;
const DEFAULT_TEMPERATURE = 0.2;

/**
 * Generate commit message with Claude CLI (subprocess call)
 */
const generateWithClaude = (prompt: string): Effect.Effect<string, ClaudeCliErrorClass> =>
  Effect.gen(function* generateWithClaudeGen() {
    yield* Effect.log('Generating commit message with Claude CLI');
    const proc = Bun.spawn(['claude', '--model', 'haiku', '-p', prompt], {
      stderr: 'pipe',
      stdout: 'pipe',
    });
    const exitCode = yield* Effect.tryPromise({
      catch: (error) =>
        new ClaudeCliErrorClass({ exitCode: -1, message: `Failed to get exit code: ${error instanceof Error ? error.message : JSON.stringify(error)}` }),
      try: () => proc.exited,
    });
    if (exitCode !== 0) {
      yield* Effect.logError(`Claude CLI exited with code ${exitCode}`);
      return yield* new ClaudeCliErrorClass({
        exitCode,
        message: `Claude CLI exited with code ${exitCode}`,
      });
    }
    const text = yield* Effect.tryPromise({
      catch: (error) =>
        new ClaudeCliErrorClass({ exitCode, message: `Failed to read stdout: ${error instanceof Error ? error.message : JSON.stringify(error)}` }),
      try: () => new Response(proc.stdout).text(),
    });
    const trimmed = text.trim();
    yield* Effect.log('Claude CLI generation completed successfully');
    return trimmed;
  });

/**
 * Generate commit message with OpenAI-compatible API using direct HTTP call
 */
const buildApiRequest = (
  prompt: string,
  preset: Preset,
): { apiUrl: string; body: string; headers: Record<string, string> } => {
  const cleanBaseUrl = preset.baseUrl.replace(/\/$/u, '');
  const apiUrl = preset.baseUrl.includes('/v1')
    ? preset.baseUrl
    : `${cleanBaseUrl}/v1/chat/completions`;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (preset.apiKey !== undefined && preset.apiKey !== '') {
    headers['Authorization'] = `Bearer ${preset.apiKey}`;
  }

  const body = JSON.stringify({
    max_tokens: preset.contextWindow ?? DEFAULT_MAX_TOKENS,
    messages: [{ content: prompt, role: 'user' }],
    model: preset.model,
    temperature: DEFAULT_TEMPERATURE,
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

const parseApiResponse = (
  response: Response,
): Effect.Effect<{ content: string }, OpenAiApiErrorClass | ApiResponseErrorClass> =>
  Effect.gen(function* parseApiResponseGen() {
    if (!response.ok) {
      yield* Effect.logError(`API request failed: ${response.status}`);
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
        const json = await response.json();
        return json as { choices: { message: { content: string } }[] };
      },
    });

    const content = data.choices[0]?.message?.content;

    if (content === undefined || content === '') {
      yield* Effect.logError('No content in API response');
      return yield* new ApiResponseErrorClass({ message: 'No content in API response' });
    }

    return { content: content.trim() };
  });

const generateWithOpenAICompatible = (
  prompt: string,
  preset: Preset,
): Effect.Effect<string, OpenAiApiErrorClass | ApiResponseErrorClass> =>
  Effect.gen(function* generateWithOpenAICompatibleGen() {
    yield* Effect.log(`Generating commit message with OpenAI-compatible API: ${preset.baseUrl}`);
    const request = buildApiRequest(prompt, preset);
    const response = yield* fetchApiResponse(request);
    const { content } = yield* parseApiResponse(response);
    yield* Effect.log('OpenAI-compatible API generation completed successfully');
    return content;
  });

export {
  COMMIT_TYPES,
  buildPrompt,
  generateWithClaude,
  generateWithOpenAICompatible,
  validateMessage,
};
export type { Preset } from './secrets.js';
