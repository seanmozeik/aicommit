import { confirm, log, outro, select, text } from '@clack/prompts';
import { Effect } from 'effect';

import { commit, push } from '../../git';
import { displayCommitMessage } from '../../ui/context-panel';
import { frappeColors, theme } from '../../ui/theme';

export const handleEditAction = (finalMessage: string): Effect.Effect<string> =>
  Effect.gen(function* handleEditActionGen() {
    const edited = yield* Effect.tryPromise({
      catch: (_error) => {
        outro(frappeColors.subtext1('Cancelled'));
        process.exit(0);
      },
      try: async () => {
        const result = await text({ initialValue: finalMessage, message: 'Edit commit message:' });
        if (typeof result === 'symbol') {
          throw new TypeError('Cancelled');
        }
        return result;
      },
    });
    displayCommitMessage(edited);
    return edited;
  });

export const handleCommitAction = (
  finalMessage: string,
  _hasStaged: boolean,
): Effect.Effect<void> =>
  Effect.gen(function* handleCommitActionGen() {
    yield* Effect.tryPromise({
      catch: (error) => {
        log.error(
          `Commit failed: ${error instanceof Error ? error.message : JSON.stringify(error)}`,
        );
        outro(theme.error('Aborted'));
        process.exit(1);
      },
      try: () => commit(finalMessage),
    });

    const shouldPush = yield* Effect.tryPromise({
      catch: (_error) => {
        outro(frappeColors.subtext1('Cancelled'));
        process.exit(0);
      },
      try: async () => {
        const result = await confirm({ message: 'Push to remote?' });
        if (typeof result === 'symbol') {
          throw new TypeError('Cancelled');
        }
        return result;
      },
    });

    if (!shouldPush) {
      outro(theme.success('Committed!'));
      process.exit(0);
    }

    yield* Effect.tryPromise({
      catch: (error) => {
        log.error(`Push failed: ${error instanceof Error ? error.message : JSON.stringify(error)}`);
        outro(theme.warning('Committed locally, but push failed'));
        process.exit(1);
      },
      try: () => push(),
    });
    outro(theme.success('Committed and pushed!'));
    process.exit(0);
  });

export const handleCopyAction = (finalMessage: string): Effect.Effect<void> =>
  Effect.gen(function* handleCopyActionGen() {
    yield* Effect.tryPromise({
      catch: () => {
        log.warn('No clipboard tool found.');
        outro(finalMessage);
        process.exit(0);
      },
      try: () => Bun.write('/tmp/aic-commit.txt', finalMessage),
    });
    outro(theme.success('Copied to clipboard!'));
    process.exit(0);
  });

export const showActionMenu =
  (
    hasStaged: boolean,
  ): ((finalMessage: string, generateMessage: Effect.Effect<string>) => Effect.Effect<never>) =>
  (initialFinalMessage: string, generateMessage: Effect.Effect<string>) =>
    Effect.gen(function* showActionMenuGen() {
      let finalMessage = initialFinalMessage;

      for (;;) {
        const action = yield* Effect.tryPromise({
          catch: (_error) => {
            outro(frappeColors.subtext1('Cancelled'));
            process.exit(0);
          },
          try: async () => {
            const result = await select({
              message: 'What would you like to do?',
              options: [
                ...(hasStaged ? [{ hint: 'staged files', label: 'Commit', value: 'commit' }] : []),
                { hint: 'modify the message', label: 'Edit', value: 'edit' },
                { hint: 'regenerate message', label: 'Retry', value: 'retry' },
                { label: 'Copy to clipboard', value: 'copy' },
                { label: 'Cancel', value: 'cancel' },
              ],
            });
            if (typeof result === 'symbol') {
              throw new TypeError('Cancelled');
            }
            return result;
          },
        });

        if (action === 'cancel') {
          outro(frappeColors.subtext1('Done'));
          process.exit(0);
        } else if (action === 'edit') {
          finalMessage = yield* handleEditAction(finalMessage);
        } else if (action === 'retry') {
          finalMessage = yield* generateMessage;
          displayCommitMessage(finalMessage);
        } else if (action === 'commit') {
          yield* handleCommitAction(finalMessage, hasStaged);
        } else if (action === 'copy') {
          yield* handleCopyAction(finalMessage);
        }
      }
    });
