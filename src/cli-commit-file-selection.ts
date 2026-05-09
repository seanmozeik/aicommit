/* oxlint-disable import/no-namespace */
import * as p from '@clack/prompts';
import { Effect } from 'effect';

import { stageFiles, getStatus, parseStatusOutput } from './git';
import { frappeColors, theme } from './ui/theme';

const MAX_FILE_SELECTION_COUNT = 15;
const STAGE_ALL_VALUE = '__stage_all__';
const SELECT_FILES_VALUE = '__select_files__';
const SKIP_VALUE = '__skip__';

const cancelSelection = (): never => {
  p.outro(frappeColors.subtext1('Cancelled'));
  process.exit(0);
  throw new Error('Cancelled');
};

const handleStageError = (error: unknown): never => {
  p.log.error(`Failed to stage files: ${error instanceof Error ? error.message : String(error)}`);
  p.outro(theme.error('Aborted'));
  process.exit(1);
  throw new Error('Aborted');
};

export const selectFilesToStage = Effect.gen(function* selectFilesToStageGen() {
  const statusOutput = yield* Effect.tryPromise(() => getStatus());

  if (!statusOutput) {
    return false;
  }

  const changedFiles = parseStatusOutput(statusOutput);

  if (changedFiles.length === 0 || changedFiles.length > MAX_FILE_SELECTION_COUNT) {
    return false;
  }

  const action = yield* Effect.tryPromise({
    catch: cancelSelection,
    try: async () => {
      const result = await p.select({
        message: 'No staged files. What should aic use?',
        options: [
          {
            hint: 'git add every changed file, then generate from staged diff',
            label: 'Stage all',
            value: STAGE_ALL_VALUE,
          },
          {
            hint: 'choose specific files to stage',
            label: 'Select files',
            value: SELECT_FILES_VALUE,
          },
          {
            hint: 'generate from all unstaged changes without staging',
            label: 'Skip',
            value: SKIP_VALUE,
          },
        ],
      });
      if (typeof result === 'symbol') {
        throw new TypeError('Cancelled');
      }
      return result;
    },
  });

  if (action === STAGE_ALL_VALUE) {
    try {
      yield* Effect.tryPromise(() => stageFiles(changedFiles.map((f) => f.path)));
      return true;
    } catch (error) {
      handleStageError(error);
    }
  }

  if (action === SKIP_VALUE) {
    return false;
  }

  const selected = yield* Effect.tryPromise({
    catch: cancelSelection,
    try: async () => {
      const result = await p.multiselect({
        message: 'Select files to stage:',
        options: changedFiles.map((f) => ({ hint: f.hint, label: f.path, value: f.path })),
      });
      if (typeof result === 'symbol') {
        throw new TypeError('Cancelled');
      }
      return result;
    },
  });

  if (selected.length > 0) {
    try {
      yield* Effect.tryPromise(() => stageFiles(selected));
      return true;
    } catch (error) {
      handleStageError(error);
    }
  }

  return false;
});
