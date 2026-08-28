import { OpenAiClient, OpenAiLanguageModel } from '@effect/ai-openai-compat';
import { BunHttpClient } from '@effect/platform-bun';
import { Duration, Effect, Layer, Redacted, Schedule } from 'effect';
import { AiError, LanguageModel, type Tool } from 'effect/unstable/ai';
import type * as HttpClient from 'effect/unstable/http/HttpClient';

import type { OpenAiCompatiblePreset } from '../config/secrets';
import { OpenAiApiError as OpenAiApiErrorClass } from '../errors/openai-api-error';
import { TimeoutError as TimeoutErrorClass } from '../errors/timeout-error';
import { ToolCallError as ToolCallErrorClass } from '../errors/tool-call-error';

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_ATTEMPTS = 2;
const DEFAULT_TEMPERATURE = 0.2;
const RETRY_DELAY_MS = 25;

interface ToolCallOptions<TOutput, TTools extends Record<string, Tool.Any>> {
  readonly attempts?: number;
  readonly extractFromCalls: (
    calls: readonly { name: string; params: unknown }[],
  ) => TOutput | null;
  readonly fallbackFromText?: (text: string) => TOutput | null;
  readonly maxOutputTokens: number;
  readonly preset: OpenAiCompatiblePreset;
  readonly systemPrompt: string;
  readonly temperature?: number;
  readonly timeoutMs?: number;
  readonly transportLayer?: Layer.Layer<HttpClient.HttpClient>;
  readonly toolkit: LanguageModel.ToolkitInput<TTools, never, never>;
  readonly userPrompt: string;
}

interface RawResponse {
  readonly finishReason: string;
  readonly text: string;
  readonly toolCalls: { name: string; params: unknown }[];
}

type ToolkitServices<TTools extends Record<string, Tool.Any>> =
  | Tool.HandlerServices<TTools[keyof TTools]>
  | Tool.ResultDecodingServices<TTools[keyof TTools]>;

const normalizeBaseUrl = (preset: OpenAiCompatiblePreset): string => {
  const cleaned = preset.baseUrl.replace(/\/$/u, '');
  if (cleaned.endsWith('/chat/completions')) {
    return cleaned.slice(0, -'/chat/completions'.length);
  }
  if (cleaned.endsWith('/v1')) {
    return cleaned;
  }
  return `${cleaned}/v1`;
};

const buildOpenAiLayer = (
  preset: OpenAiCompatiblePreset,
  transportLayer: Layer.Layer<HttpClient.HttpClient> = BunHttpClient.layer,
): Layer.Layer<OpenAiClient.OpenAiClient> => {
  const apiKey = preset.apiKey ?? '';
  return OpenAiClient.layer({
    apiKey: Redacted.make(apiKey === '' ? 'not-needed' : apiKey),
    apiUrl: normalizeBaseUrl(preset),
  }).pipe(Layer.provide(transportLayer));
};

const aiErrorStatus = (error: AiError.AiError): number =>
  'http' in error.reason ? (error.reason.http?.response?.status ?? 0) : 0;

const aiErrorResponseBody = (error: AiError.AiError): string | undefined =>
  'http' in error.reason ? error.reason.http?.body : undefined;

const isTimeout = (error: unknown): boolean =>
  error instanceof Error && error.name === 'TimeoutException';

const isTransientGenerationError = (error: unknown): boolean => {
  if (isTimeout(error)) {
    return true;
  }
  if (!AiError.isAiError(error)) {
    return false;
  }
  const statusCode = aiErrorStatus(error);
  if (statusCode !== 0) {
    return statusCode === 408 || statusCode === 429 || statusCode >= 500;
  }
  return error.reason._tag === 'NetworkError' && error.reason.reason === 'TransportError';
};

const interpret = <TOutput, TTools extends Record<string, Tool.Any>>(
  raw: RawResponse,
  options: ToolCallOptions<TOutput, TTools>,
): TOutput | ToolCallErrorClass => {
  const fromCalls = options.extractFromCalls(raw.toolCalls);
  if (fromCalls !== null) {
    return fromCalls;
  }
  if (options.fallbackFromText !== undefined) {
    const fromText = options.fallbackFromText(raw.text);
    if (fromText !== null) {
      return fromText;
    }
  }
  return new ToolCallErrorClass({
    finishReason: raw.finishReason,
    message: `model returned no usable output (toolCalls=${raw.toolCalls.length}, finishReason=${raw.finishReason})`,
    toolCallsCount: raw.toolCalls.length,
  });
};

const mapError = <TTools extends Record<string, Tool.Any>>(
  error: unknown,
  options: ToolCallOptions<unknown, TTools>,
): OpenAiApiErrorClass | ToolCallErrorClass | TimeoutErrorClass => {
  if (
    error instanceof OpenAiApiErrorClass ||
    error instanceof ToolCallErrorClass ||
    error instanceof TimeoutErrorClass
  ) {
    return error;
  }
  if (isTimeout(error)) {
    return new TimeoutErrorClass({
      message: `AI generation timed out after ${options.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
  }
  if (AiError.isAiError(error)) {
    const responseBody = aiErrorResponseBody(error);
    return new OpenAiApiErrorClass({
      error,
      message: error.message,
      ...(responseBody !== undefined && { responseBody }),
      statusCode: aiErrorStatus(error),
    });
  }
  const detail = error instanceof Error ? error.message : String(error);
  return new OpenAiApiErrorClass({ error, message: detail, statusCode: 0 });
};

const mapErrorForOptions =
  <TTools extends Record<string, Tool.Any>>(
    options: ToolCallOptions<unknown, TTools>,
  ): ((error: unknown) => OpenAiApiErrorClass | ToolCallErrorClass | TimeoutErrorClass) =>
  (error) =>
    mapError(error, options);

export const generateWithToolkit = <TOutput, TTools extends Record<string, Tool.Any>>(
  options: ToolCallOptions<TOutput, TTools>,
): Effect.Effect<
  TOutput,
  OpenAiApiErrorClass | ToolCallErrorClass | TimeoutErrorClass,
  ToolkitServices<TTools>
> =>
  Effect.gen(function* generateWithToolkitImpl() {
    yield* Effect.annotateCurrentSpan({
      'ai.attempts': options.attempts ?? DEFAULT_ATTEMPTS,
      'ai.max_output_tokens': options.maxOutputTokens,
      'ai.model': options.preset.model,
      'ai.provider': options.preset.baseUrl,
    });
    yield* Effect.logInfo(`Generating with model: ${options.preset.model}`);

    const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
    const model = OpenAiLanguageModel.model(options.preset.model, {
      max_output_tokens: options.maxOutputTokens,
      temperature: options.temperature ?? DEFAULT_TEMPERATURE,
    });
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const response = yield* LanguageModel.generateText({
      prompt: [
        { content: options.systemPrompt, role: 'system' },
        { content: options.userPrompt, role: 'user' },
      ],
      toolChoice: 'required',
      toolkit: options.toolkit,
    }).pipe(
      Effect.provide(model),
      Effect.timeout(Duration.millis(timeoutMs)),
      Effect.retry({
        schedule: Schedule.spaced(Duration.millis(RETRY_DELAY_MS)),
        times: Math.max(0, attempts - 1),
        while: isTransientGenerationError,
      }),
    );
    const raw: RawResponse = {
      finishReason: response.finishReason,
      text: response.text,
      toolCalls: response.toolCalls.map((call) => ({ name: call.name, params: call.params })),
    };
    const result = interpret(raw, options);
    if (result instanceof ToolCallErrorClass) {
      yield* Effect.logError(`AI tool call failed: ${result.message}`);
      return yield* result;
    }
    yield* Effect.logInfo('AI generation succeeded');
    return result;
  }).pipe(
    Effect.withSpan('ai.toolkit.generate'),
    Effect.provide(buildOpenAiLayer(options.preset, options.transportLayer)),
    Effect.mapError(mapErrorForOptions(options)),
  );
