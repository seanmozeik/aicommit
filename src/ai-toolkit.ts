// Shared Effect AI Toolkit plumbing for any LLM call against an
// OpenAI-compatible HTTP endpoint. Mirrors the pattern in
// `~/dev/vault/scripts/session-extract/extract.ts` — `Tool.make` +
// `Toolkit.make` + `LanguageModel.generateText` + `ExecutionPlan` retries.
//
// Why we use the toolkit over hand-rolled `fetch`:
//   - `tool_choice: 'required'` (string form) is honoured by every
//     OpenAI-compat backend we hit (vLLM, sglang, llama.cpp, OpenAI).
//     The object form (`{ function: { name }, type: 'function' }`) was
//     Ignored by several local backends, which silently fell back to
//     Plain `content` — the bug we're fixing here.
//   - The toolkit reads `response.toolCalls` typed; no JSON.parse on
//     `tool_calls[0].function.arguments`.
//   - `ExecutionPlan` retries handle transient sidecar failures.
//
// Per-call presets (`baseUrl`, `apiKey`, `model`) come from the user's
// Keychain, not env — so the OpenAI layer is built per-invocation and
// Provided via `Effect.provide`.

import { OpenAiClient, OpenAiLanguageModel } from '@effect/ai-openai-compat';
import { BunHttpClient } from '@effect/platform-bun';
import { Duration, Effect, ExecutionPlan, Layer, Redacted } from 'effect';
import { LanguageModel, type Toolkit } from 'effect/unstable/ai';

import {
  OpenAiApiError as OpenAiApiErrorClass,
  TimeoutError as TimeoutErrorClass,
  ToolCallError as ToolCallErrorClass,
} from './errors/index';
import type { Preset } from './secrets';

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_ATTEMPTS = 2;
const DEFAULT_TEMPERATURE = 0.2;

const normalizeBaseUrl = (preset: Preset): string => {
  // Effect AI's OpenAI client appends `/chat/completions` itself, so we
  // Need the `/v1` root, not the full chat-completions URL. Match the
  // Hand-rolled code's URL detection so any preset that previously worked
  // Continues to work.
  const cleaned = preset.baseUrl.replace(/\/$/u, '');
  if (cleaned.endsWith('/chat/completions')) {
    return cleaned.slice(0, -'/chat/completions'.length);
  }
  if (cleaned.endsWith('/v1')) {
    return cleaned;
  }
  return `${cleaned}/v1`;
};

const buildOpenAiLayer = (preset: Preset): Layer.Layer<OpenAiClient.OpenAiClient> => {
  const apiKey = preset.apiKey ?? '';
  return OpenAiClient.layer({
    apiKey: Redacted.make(apiKey === '' ? 'not-needed' : apiKey),
    apiUrl: normalizeBaseUrl(preset),
  }).pipe(Layer.provide(BunHttpClient.layer));
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- erased in caller signatures via extractFromCalls
type AnyToolkit = Toolkit.Toolkit<Record<string, any>>;

interface ToolCallOptions<TOutput> {
  readonly preset: Preset;
  readonly toolkit: AnyToolkit;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- erased Layer of the same toolkit
  readonly toolkitLayer: Layer.Layer<any>;
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly maxOutputTokens: number;
  readonly extractFromCalls: (
    calls: readonly { name: string; params: unknown }[],
  ) => TOutput | null;
  readonly fallbackFromText?: (text: string) => TOutput | null;
  readonly timeoutMs?: number;
  readonly attempts?: number;
  readonly temperature?: number;
}

interface RawResponse {
  readonly toolCalls: { name: string; params: unknown }[];
  readonly text: string;
  readonly finishReason: string;
}

const interpret = <TOutput>(
  raw: RawResponse,
  options: ToolCallOptions<TOutput>,
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

const mapError = (
  error: unknown,
  options: ToolCallOptions<unknown>,
): OpenAiApiErrorClass | ToolCallErrorClass | TimeoutErrorClass => {
  if (
    error instanceof OpenAiApiErrorClass ||
    error instanceof ToolCallErrorClass ||
    error instanceof TimeoutErrorClass
  ) {
    return error;
  }
  // Convert timeout errors to our custom TimeoutError
  if (error instanceof Error && error.name === 'TimeoutException') {
    return new TimeoutErrorClass({
      message: `AI generation timed out after ${options.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
  }
  const detail = error instanceof Error ? error.message : String(error);
  return new OpenAiApiErrorClass({ error, message: detail, statusCode: 0 });
};

const mapErrorForOptions =
  (
    options: ToolCallOptions<unknown>,
  ): ((error: unknown) => OpenAiApiErrorClass | ToolCallErrorClass | TimeoutErrorClass) =>
  (error) =>
    mapError(error, options);

// Single-shot LLM call with `tool_choice: 'required'` and ExecutionPlan
// Retries. Returns the typed payload extracted from the model's tool call.
// Falls back to text content only if `fallbackFromText` is supplied AND no
// Tool calls landed — for hosts that occasionally drop tool_choice on
// First attempt and we want to be lenient.
const generateWithToolkit = <TOutput>(
  options: ToolCallOptions<TOutput>,
): Effect.Effect<TOutput, ToolCallErrorClass | TimeoutErrorClass | OpenAiApiErrorClass> =>
  Effect.gen(function* generateWithToolkitImpl() {
    yield* Effect.annotateCurrentSpan({
      'ai.attempts': options.attempts ?? DEFAULT_ATTEMPTS,
      'ai.max_output_tokens': options.maxOutputTokens,
      'ai.model': options.preset.model,
      'ai.provider': options.preset.baseUrl,
    });
    yield* Effect.logInfo(`Generating with model: ${options.preset.model}`);

    const retryPlan = ExecutionPlan.make({
      attempts: options.attempts ?? DEFAULT_ATTEMPTS,
      provide: OpenAiLanguageModel.model(options.preset.model, {
        max_output_tokens: options.maxOutputTokens,
        temperature: options.temperature ?? DEFAULT_TEMPERATURE,
      }),
    });
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const response = yield* LanguageModel.generateText({
      prompt: [
        { content: options.systemPrompt, role: 'system' },
        { content: options.userPrompt, role: 'user' },
      ],
      toolChoice: 'required',
      toolkit: options.toolkit,
    }).pipe(Effect.withExecutionPlan(retryPlan), Effect.timeout(Duration.millis(timeoutMs)));
    const raw: RawResponse = {
      finishReason: response.finishReason,
      text: response.text,
      toolCalls: response.toolCalls.map((c) => ({ name: c.name, params: c.params })),
    };
    const result = interpret(raw, options);
    if (result instanceof ToolCallErrorClass) {
      yield* Effect.logError(`AI tool call failed: ${result.message}`);
      return yield* Effect.fail(result);
    }
    yield* Effect.logInfo('AI generation succeeded');
    return result;
  }).pipe(
    Effect.withSpan('ai.toolkit.generate'),
    Effect.provide(options.toolkitLayer),
    Effect.provide(buildOpenAiLayer(options.preset)),
    Effect.mapError(mapErrorForOptions(options)),
  );

export { generateWithToolkit, normalizeBaseUrl };
