import { Duration, Effect, Schema } from 'effect';
import { Tool, Toolkit } from 'effect/unstable/ai';

import { buildSystemPrompt } from '../commit/prompt';
import type { OpenAiCompatiblePreset } from '../config/secrets';
import { ClaudeCliError as ClaudeCliErrorClass } from '../errors/claude-cli-error';
import type { OpenAiApiError as OpenAiApiErrorClass } from '../errors/openai-api-error';
import { TimeoutError } from '../errors/timeout-error';
import type { ToolCallError } from '../errors/tool-call-error';
import { acquireProcess, CLI_GENERATION_TIMEOUT_MS } from './cli-process';
import { getModelBudgets as deriveModelBudgets } from './model-budgets';
import { generateWithToolkit } from './toolkit';

interface ClaudeGenerationOptions {
  readonly command?: readonly string[];
  readonly timeoutMs?: number;
}

const generateWithClaude = (
  prompt: string,
  options: ClaudeGenerationOptions = {},
): Effect.Effect<string, ClaudeCliErrorClass | TimeoutError> =>
  Effect.gen(function* generateWithClaudeImpl() {
    yield* Effect.logInfo('Generating with Claude CLI');
    const proc = yield* acquireProcess(
      options.command ?? ['claude', '--model', 'haiku', '-p', prompt],
      (error) =>
        new ClaudeCliErrorClass({
          exitCode: -1,
          message: `Failed to start Claude CLI: ${error instanceof Error ? error.message : String(error)}`,
        }),
    );
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
      yield* Effect.logError(`Claude CLI failed: ${stderr.trim() || `exit code ${exitCode}`}`);
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
    yield* Effect.logInfo('Claude CLI generation succeeded');
    return text.trim();
  }).pipe(
    Effect.scoped,
    Effect.timeoutOrElse({
      duration: Duration.millis(options.timeoutMs ?? CLI_GENERATION_TIMEOUT_MS),
      orElse: () =>
        new TimeoutError({
          message: 'Claude CLI generation timed out',
          timeoutMs: options.timeoutMs ?? CLI_GENERATION_TIMEOUT_MS,
        }),
    }),
    Effect.withSpan('ai.claude.generate'),
  );

const SubmitCommitMessage = Tool.make('SubmitCommitMessage', {
  description: 'Submit the final one-line conventional commit message.',
  failureMode: 'return',
  parameters: Schema.Struct({ message: Schema.String }),
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
  preset: OpenAiCompatiblePreset,
): Effect.Effect<string, ToolCallError | TimeoutError | OpenAiApiErrorClass> =>
  Effect.gen(function* generateWithOpenAICompatibleImpl() {
    yield* Effect.annotateCurrentSpan({ 'ai.model': preset.model, 'ai.provider': preset.baseUrl });
    const budgets = deriveModelBudgets(preset);
    return yield* generateWithToolkit({
      extractFromCalls: (calls) => {
        const call = calls.find((candidate) => candidate.name === 'SubmitCommitMessage');
        if (call === undefined) {
          return null;
        }
        const { params } = call;
        const message =
          typeof params === 'object' &&
          params !== null &&
          'message' in params &&
          typeof params.message === 'string'
            ? params.message.trim()
            : '';
        return message.length > 0 ? message : null;
      },
      fallbackFromText: (text) => {
        const trimmed = text.trim();
        return trimmed.length > 0 ? trimmed : null;
      },
      maxOutputTokens: budgets.maxOutputTokens,
      preset,
      systemPrompt: buildSystemPrompt(),
      toolkit: CommitToolkit.pipe(Effect.provide(CommitToolkitLayer)),
      userPrompt: prompt,
    });
  }).pipe(Effect.withSpan('ai.openai.generate'));

export { generateWithCodex } from './codex';
export { COMMIT_TYPES } from '../commit/types';
export { buildBudgetedCommitPrompt, buildPrompt } from '../commit/prompt';
export { estimateTokens } from '../commit/tokenizer';
export { generateWithClaude };
export type { ClaudeGenerationOptions };
export { validateMessage } from '../commit/validation';
export { getModelBudgets } from './model-budgets';
export { generateWithOpenAICompatible };
