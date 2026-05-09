/* oxlint-disable import/no-namespace */
import * as p from '@clack/prompts';
import { Effect } from 'effect';

import {
  COMMIT_TYPES,
  buildPrompt,
  generateWithClaude,
  generateWithOpenAICompatible,
  validateMessage,
} from './ai.js';
import type { Preset } from './secrets.js';
import type { SemanticInfo } from './types.js';
import { frappeColors, theme } from './ui/theme.js';

export interface GenerationInput {
  compressedDiffs: string;
  fileList: string;
  presetConfig: Preset | null;
  presetName: string;
  recentCommits: string[];
  selectedType: string;
  semantics: SemanticInfo;
  stats: string;
  userInput: string;
}

export const generateCommitMessage = (
  input: GenerationInput,
): Effect.Effect<string> =>
  Effect.gen(function* generateCommitMessageGen() {
    const {
      compressedDiffs,
      fileList,
      presetConfig,
      presetName,
      recentCommits,
      selectedType,
      semantics,
      stats,
      userInput,
    } = input;

    const prompt = buildPrompt({
      compressedDiffs,
      fileList,
      recentCommits,
      selectedType,
      semantics,
      stats,
      userInput,
    });

    const s = p.spinner();
    s.start(frappeColors.subtext1(`Generating with preset "${presetName}"...`));

    const message = yield* (presetConfig === null
      ? generateWithClaude(prompt)
      : generateWithOpenAICompatible(prompt, presetConfig));

    const validated = validateMessage(message);
    s.stop(frappeColors.subtext1('Done'));
    return validated;
  }).pipe(
    Effect.catchTags({
      ApiResponseError: (error) => {
        p.spinner().stop(theme.error('Failed'));
        p.log.error(`API response error: ${error.message}`);
        return Effect.die(error);
      },
      ClaudeCliError: (error) => {
        p.spinner().stop(theme.error('Failed'));
        p.log.error(`Claude CLI error (exit code ${error.exitCode}): ${error.message}`);
        return Effect.die(error);
      },
      OpenAiApiError: (error) => {
        p.spinner().stop(theme.error('Failed'));
        p.log.error(`API error (${error.statusCode}): ${error.message}`);
        return Effect.die(error);
      },
    }),
  );

export const selectCommitType = Effect.gen(function* selectCommitTypeGen() {
  const typeOptions = [
    { hint: 'Let AI choose the best type', label: 'auto', value: 'auto' },
    ...Object.entries(COMMIT_TYPES).map(([type, desc]) => ({
      hint: desc,
      label: type,
      value: type,
    })),
  ];

  return yield* Effect.tryPromise({
    catch: (_error) => {
      p.outro(frappeColors.subtext1('Cancelled'));
      process.exit(0);
      throw new Error('Cancelled');
    },
    try: async () => {
      const result = await p.select({
        initialValue: 'auto',
        message: 'Commit type:',
        options: typeOptions,
      });
      if (typeof result === 'symbol') {
        throw new TypeError('Cancelled');
      }
      return result;
    },
  });
});

export const selectUserDescription = Effect.gen(function* selectUserDescriptionGen() {
  return yield* Effect.tryPromise({
    catch: (_error) => {
      p.outro(frappeColors.subtext1('Cancelled'));
      process.exit(0);
      throw new Error('Cancelled');
    },
    try: async () => {
      const result = await p.text({
        defaultValue: '',
        message: 'Describe your changes (optional):',
      });
      if (typeof result === 'symbol') {
        throw new TypeError('Cancelled');
      }
      return result;
    },
  });
});