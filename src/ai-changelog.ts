// Keep a Changelog generation. Same Toolkit pattern as ai.ts — the
// Submit-tool returns markdown instead of a commit message.

import { Effect, type Layer, Schema } from 'effect';
import { Tool, Toolkit } from 'effect/unstable/ai';

import { generateWithToolkit } from './ai-toolkit';
import type {
  OpenAiApiError as OpenAiApiErrorClass,
  TimeoutError,
  ToolCallError,
} from './errors/index';
import type { Preset } from './secrets';

const DEFAULT_CONTEXT_WINDOW = 32_000;
const OUTPUT_CONTEXT_FRACTION = 0.1;
const MIN_OUTPUT_TOKENS = 64;

const CHANGELOG_SYSTEM_PROMPT =
  'Use the SubmitChangelog tool with the Keep a Changelog markdown body (no version heading or date).';

const SubmitChangelog = Tool.make('SubmitChangelog', {
  description: 'Submit the final Keep a Changelog markdown body for one release.',
  failureMode: 'return',
  parameters: Schema.Struct({
    markdown: Schema.String.annotate({
      description:
        'Markdown body containing only Keep a Changelog sections such as Added, Changed, Fixed, and Removed.',
    }),
  }),
  success: Schema.Struct({ ok: Schema.Literal(true) }),
});

const ChangelogToolkit = Toolkit.make(SubmitChangelog);

const ChangelogToolkitLayer = ChangelogToolkit.toLayer(
  Effect.succeed(
    ChangelogToolkit.of({ SubmitChangelog: () => Effect.succeed({ ok: true as const }) }),
  ),
);

const maxOutputTokens = (preset: Preset): number =>
  Math.max(
    MIN_OUTPUT_TOKENS,
    Math.floor((preset.contextWindow ?? DEFAULT_CONTEXT_WINDOW) * OUTPUT_CONTEXT_FRACTION),
  );

export const generateChangelogWithOpenAICompatible = (
  prompt: string,
  preset: Preset,
): Effect.Effect<string, ToolCallError | TimeoutError | OpenAiApiErrorClass> =>
  Effect.gen(function* generateChangelogWithOpenAICompatibleImpl() {
    yield* Effect.annotateCurrentSpan({ 'ai.model': preset.model, 'ai.provider': preset.baseUrl });
    return yield* generateWithToolkit({
      extractFromCalls: (calls) => {
        const call = calls.find((c) => c.name === 'SubmitChangelog');
        if (call === undefined) {
          return null;
        }
        // eslint-disable-next-line typescript/no-unsafe-type-assertion -- params shape is enforced by the SubmitChangelog tool schema
        const params = call.params as { markdown?: unknown };
        const md = typeof params.markdown === 'string' ? params.markdown.trim() : '';
        return md.length > 0 ? md : null;
      },
      fallbackFromText: (text) => {
        const trimmed = text.trim();
        return trimmed.length > 0 ? trimmed : null;
      },
      maxOutputTokens: maxOutputTokens(preset),
      preset,
      systemPrompt: CHANGELOG_SYSTEM_PROMPT,
      // eslint-disable-next-line typescript/no-unsafe-type-assertion, typescript/no-explicit-any -- generic erasure for the helper signature; TInput is reconstructed at extractFromCalls
      toolkit: ChangelogToolkit as unknown as Toolkit.Toolkit<Record<string, any>>,
      // eslint-disable-next-line typescript/no-unsafe-type-assertion -- generic erasure on the matching layer
      toolkitLayer: ChangelogToolkitLayer as Layer.Layer<unknown>,
      userPrompt: prompt,
    });
  }).pipe(Effect.withSpan('ai.changelog.generate'));
