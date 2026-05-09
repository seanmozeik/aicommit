/* oxlint-disable import/no-namespace */
import * as p from '@clack/prompts';
import { Effect } from 'effect';

import { commit, push } from './git.js';
import { displayCommitMessage } from './ui/context-panel.js';
import { frappeColors, theme } from './ui/theme.js';

export const handleEditAction = (finalMessage: string): Effect.Effect<string> =>
  Effect.gen(function* handleEditActionGen() {
    const edited = yield* Effect.tryPromise({
      catch: (_error) => {
        p.outro(frappeColors.subtext1('Cancelled'));
        process.exit(0);
        throw new Error('Cancelled');
      },
      try: async () => {
        const result = await p.text({
          initialValue: finalMessage,
          message: 'Edit commit message:',
        });
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
        p.log.error(`Commit failed: ${error instanceof Error ? error.message : JSON.stringify(error)}`);
        p.outro(theme.error('Aborted'));
        process.exit(1);
        throw new Error('Aborted');
      },
      try: () => commit(finalMessage),
    });

    const shouldPush = yield* Effect.tryPromise({
      catch: (_error) => {
        p.outro(frappeColors.subtext1('Cancelled'));
        process.exit(0);
        throw new Error('Cancelled');
      },
      try: async () => {
        const result = await p.confirm({ message: 'Push to remote?' });
        if (typeof result === 'symbol') {
          throw new TypeError('Cancelled');
        }
        return result;
      },
    });

    if (!shouldPush) {
      p.outro(theme.success('Committed!'));
      process.exit(0);
    }

    yield* Effect.tryPromise({
      catch: (error) => {
        p.log.error(`Push failed: ${error instanceof Error ? error.message : JSON.stringify(error)}`);
        p.outro(theme.warning('Committed locally, but push failed'));
        process.exit(1);
        throw new Error('Push failed');
      },
      try: () => push(),
    });
    p.outro(theme.success('Committed and pushed!'));
    process.exit(0);
  });

export const handleCopyAction = (finalMessage: string): Effect.Effect<void> =>
  Effect.gen(function* handleCopyActionGen() {
    yield* Effect.tryPromise({
      catch: () => {
        p.log.warn('No clipboard tool found.');
        p.outro(finalMessage);
        process.exit(0);
        throw new Error('No clipboard tool');
      },
      try: () => Bun.write('/tmp/aic-commit.txt', finalMessage),
    });
    p.outro(theme.success('Copied to clipboard!'));
    process.exit(0);
  });

export const showActionMenu = (
  hasStaged: boolean,
): ((finalMessage: string, generateMessage: Effect.Effect<string>) => Effect.Effect<never>) =>
  (initialFinalMessage: string, generateMessage: Effect.Effect<string>) =>
    Effect.gen(function* showActionMenuGen() {
      let finalMessage = initialFinalMessage;

      while (true) {
        const action = yield* Effect.tryPromise({
          catch: (_error) => {
            p.outro(frappeColors.subtext1('Cancelled'));
            process.exit(0);
            throw new Error('Cancelled');
          },
          try: async () => {
            const result = await p.select({
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
            return result as string;
          },
        });

        if (action === 'cancel') {
          p.outro(frappeColors.subtext1('Done'));
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