/* oxlint-disable import/no-namespace */
import * as p from '@clack/prompts';
import { Effect } from 'effect';

import { stageFiles, getStatus, parseStatusOutput } from './git';
import { frappeColors, theme } from './ui/theme';

const MAX_FILE_SELECTION_COUNT = 15;

export const selectFilesToStage = Effect.gen(function* selectFilesToStageGen() {
  const statusOutput = yield* Effect.tryPromise(() => getStatus());

  if (!statusOutput) {
    return false;
  }

  const changedFiles = parseStatusOutput(statusOutput);

  if (changedFiles.length === 0 || changedFiles.length > MAX_FILE_SELECTION_COUNT) {
    return false;
  }

  const selected = yield* Effect.tryPromise({
    catch: (_error) => {
      p.outro(frappeColors.subtext1('Cancelled'));
      process.exit(0);
      throw new Error('Cancelled');
    },
    try: async () => {
      const result = await p.multiselect({
        message: 'Select files to stage:',
        options: [
          { hint: 'generate from all changes', label: 'Skip', value: '__skip__' },
          ...changedFiles.map((f) => ({ hint: f.hint, label: f.path, value: f.path })),
        ],
      });
      if (typeof result === 'symbol') {
        throw new TypeError('Cancelled');
      }
      return result;
    },
  });

  const filesToStage = selected.filter((f) => f !== '__skip__');
  if (filesToStage.length > 0) {
    try {
      yield* Effect.tryPromise(() => stageFiles(filesToStage));
      return true;
    } catch (error) {
      p.log.error(
        `Failed to stage files: ${error instanceof Error ? error.message : String(error)}`,
      );
      p.outro(theme.error('Aborted'));
      process.exit(1);
    }
  }

  return false;
});
