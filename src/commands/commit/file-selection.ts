import { log, multiselect, outro, select } from '@clack/prompts';
import { Effect } from 'effect';

import { stageFiles, getStatus, parseStatusOutput } from '../../git';
import { frappeColors, theme } from '../../ui/theme';

const MAX_FILE_SELECTION_COUNT = 15;
const STAGE_ALL_VALUE = '__stage_all__';
const SELECT_FILES_VALUE = '__select_files__';
const SKIP_VALUE = '__skip__';

const cancelSelection = (): never => {
  outro(frappeColors.subtext1('Cancelled'));
  process.exit(0);
};

const handleStageError = (error: unknown): never => {
  log.error(`Failed to stage files: ${error instanceof Error ? error.message : String(error)}`);
  outro(theme.error('Aborted'));
  process.exit(1);
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
      const result = await select({
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
    yield* Effect.tryPromise(() => stageFiles(changedFiles.map((f) => f.path))).pipe(
      Effect.catch((error) => Effect.sync(() => handleStageError(error))),
    );
    return true;
  }

  if (action === SKIP_VALUE) {
    return false;
  }

  const selected = yield* Effect.tryPromise({
    catch: cancelSelection,
    try: async () => {
      const result = await multiselect({
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
    yield* Effect.tryPromise(() => stageFiles(selected)).pipe(
      Effect.catch((error) => Effect.sync(() => handleStageError(error))),
    );
    return true;
  }

  return false;
});
