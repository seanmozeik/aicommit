// LLM call orchestration. Three backends:
//   - Claude CLI (subprocess: `claude --model haiku -p`)
//   - Codex CLI (subprocess: `codex exec ...`) — see ./ai-codex.ts
//   - OpenAI-compatible HTTP — uses the Effect AI Toolkit pattern from
//     ~/dev/vault/scripts/session-extract/extract.ts (Tool.make /
//     Toolkit.make / generateText / ExecutionPlan retries)
//
// History note: the OpenAI-compatible path used to hand-roll a `fetch`
// To `/v1/chat/completions` with `tool_choice: { function: { name }, type:
// 'function' }`. That object form is honoured by OpenAI proper but ignored
// By several local backends (vLLM, sglang, llama.cpp), which silently fell
// Back to plain `content` and broke the tool-call contract. The toolkit
// Uses `tool_choice: 'required'` (string form) which works across all
// Backends, and reads `response.toolCalls` typed instead of parsing
// `tool_calls[0].function.arguments`.

import { Effect, type Layer, Schema } from 'effect';
import { Tool, Toolkit } from 'effect/unstable/ai';

import { generateWithCodex } from './ai-codex';
import { generateWithToolkit } from './ai-toolkit';
import { COMMIT_TYPES } from './commit-types';
import {
  ClaudeCliError as ClaudeCliErrorClass,
  type OpenAiApiError as OpenAiApiErrorClass,
} from './errors/index.js';
import { buildPrompt, buildSystemPrompt } from './prompt';
import type { Preset } from './secrets';
import { estimateTokens } from './tokenizer';
import { validateMessage } from './validation';

const DEFAULT_CONTEXT_WINDOW = 32_000;
const INPUT_CONTEXT_FRACTION = 0.25;
const OUTPUT_CONTEXT_FRACTION = 0.05;
const MIN_INPUT_TOKENS = 1000;
const MIN_OUTPUT_TOKENS = 64;

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

// --- Claude CLI subprocess (unchanged) ----------------------------------

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
    return text.trim();
  });

// --- OpenAI-compatible (Effect AI Toolkit) ------------------------------

const SubmitCommitMessage = Tool.make('SubmitCommitMessage', {
  description: 'Submit the final one-line conventional commit message.',
  failureMode: 'return',
  parameters: Schema.Struct({
    message: Schema.String.annotate({
      description: 'A single conventional commit subject, at most 72 characters.',
    }),
  }),
  success: Schema.Struct({ ok: Schema.Literal(true) }),
});

const CommitToolkit = Toolkit.make(SubmitCommitMessage);

const CommitToolkitLayer = CommitToolkit.toLayer(
  Effect.succeed(
    CommitToolkit.of({ SubmitCommitMessage: () => Effect.succeed({ ok: true as const }) }),
  ),
);

const generateWithOpenAICompatible = (
  prompt: string,
  preset: Preset,
): Effect.Effect<string, OpenAiApiErrorClass> => {
  const budgets = getModelBudgets(preset);
  return generateWithToolkit({
    extractFromCalls: (calls) => {
      const call = calls.find((c) => c.name === 'SubmitCommitMessage');
      if (call === undefined) {
        return null;
      }
      // eslint-disable-next-line typescript/no-unsafe-type-assertion -- params shape is enforced by the SubmitCommitMessage tool schema
      const params = call.params as { message?: unknown };
      const message = typeof params.message === 'string' ? params.message.trim() : '';
      return message.length > 0 ? message : null;
    },
    // Some local backends still occasionally return prose. Accept it as a
    // Last-resort fallback rather than crashing — the validateMessage call
    // Downstream will reject obvious junk anyway.
    fallbackFromText: (text) => {
      const trimmed = text.trim();
      return trimmed.length > 0 ? trimmed : null;
    },
    maxOutputTokens: budgets.maxOutputTokens,
    preset,
    systemPrompt: buildSystemPrompt(),
    // eslint-disable-next-line typescript/no-unsafe-type-assertion, typescript/no-explicit-any -- generic erasure: Toolkit.Toolkit<{...}> → Toolkit<Record<string,any>> for the helper signature; TInput is reconstructed at extractFromCalls
    toolkit: CommitToolkit as unknown as Toolkit.Toolkit<Record<string, any>>,
    // eslint-disable-next-line typescript/no-unsafe-type-assertion -- generic erasure on the matching layer
    toolkitLayer: CommitToolkitLayer as Layer.Layer<unknown>,
    userPrompt: prompt,
  });
};

export { COMMIT_TYPES, buildPrompt, estimateTokens, generateWithClaude, generateWithCodex };
export { generateWithOpenAICompatible, getModelBudgets, validateMessage };
export type { ModelBudgets };
export type { Preset } from './secrets.js';
