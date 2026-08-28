import { Effect, Schema } from 'effect';
import { Tool, Toolkit } from 'effect/unstable/ai';

import type { OpenAiCompatiblePreset } from '../config/secrets';
import type { OpenAiApiError as OpenAiApiErrorClass } from '../errors/openai-api-error';
import type { TimeoutError } from '../errors/timeout-error';
import type { ToolCallError } from '../errors/tool-call-error';
import { generateWithToolkit } from './toolkit';

const DEFAULT_CONTEXT_WINDOW = 32_000;
const OUTPUT_CONTEXT_FRACTION = 0.1;
const MIN_OUTPUT_TOKENS = 64;

export const CHANGELOG_SYSTEM_PROMPT =
  'Use the SubmitChangelog tool with the Keep a Changelog markdown body (no version heading or date).';
export const CODEX_CHANGELOG_SYSTEM_PROMPT =
  'Return the Keep a Changelog markdown body in the structured output message field, without a version heading or date.';
export const CODEX_CHANGELOG_OUTPUT_DESCRIPTION =
  'A Keep a Changelog markdown body without a version heading or date.';

const SubmitChangelog = Tool.make('SubmitChangelog', {
  description: 'Submit the final Keep a Changelog markdown body for one release.',
  failureMode: 'return',
  parameters: Schema.Struct({ markdown: Schema.String }),
  success: Schema.Struct({ ok: Schema.Literal(true) }),
});

const ChangelogToolkit = Toolkit.make(SubmitChangelog);
const ChangelogToolkitLayer = ChangelogToolkit.toLayer(
  Effect.succeed(
    ChangelogToolkit.of({ SubmitChangelog: () => Effect.succeed({ ok: true as const }) }),
  ),
);

const maxOutputTokens = (preset: OpenAiCompatiblePreset): number =>
  Math.max(
    MIN_OUTPUT_TOKENS,
    Math.floor((preset.contextWindow ?? DEFAULT_CONTEXT_WINDOW) * OUTPUT_CONTEXT_FRACTION),
  );

export const generateChangelogWithOpenAICompatible = (
  prompt: string,
  preset: OpenAiCompatiblePreset,
): Effect.Effect<string, ToolCallError | TimeoutError | OpenAiApiErrorClass> =>
  Effect.gen(function* generateChangelogWithOpenAICompatibleImpl() {
    yield* Effect.annotateCurrentSpan({ 'ai.model': preset.model, 'ai.provider': preset.baseUrl });
    return yield* generateWithToolkit({
      extractFromCalls: (calls) => {
        const call = calls.find((candidate) => candidate.name === 'SubmitChangelog');
        if (call === undefined) {
          return null;
        }
        const { params } = call;
        if (typeof params !== 'object' || params === null || !('markdown' in params)) {
          return null;
        }
        const { markdown } = params;
        if (typeof markdown !== 'string') {
          return null;
        }
        const trimmed = markdown.trim();
        return trimmed.length > 0 ? trimmed : null;
      },
      fallbackFromText: (text) => {
        const trimmed = text.trim();
        return trimmed.length > 0 ? trimmed : null;
      },
      maxOutputTokens: maxOutputTokens(preset),
      preset,
      systemPrompt: CHANGELOG_SYSTEM_PROMPT,
      toolkit: ChangelogToolkit.pipe(Effect.provide(ChangelogToolkitLayer)),
      userPrompt: prompt,
    });
  }).pipe(Effect.withSpan('ai.changelog.generate'));
