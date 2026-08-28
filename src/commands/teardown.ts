import { confirm, intro, isCancel, outro, select, spinner } from '@clack/prompts';
import { Effect } from 'effect';
import { Command } from 'effect/unstable/cli';

import { deletePreset, deleteSecretBlob, listPresets, loadDefaultPreset } from '../config/secrets';
import { TeardownError } from '../errors/teardown-error';
import { showBanner } from '../ui/banner';
import { frappeColors, theme } from '../ui/theme';

interface TeardownPersistence {
  readonly deleteAll: () => Promise<boolean>;
  readonly deleteOne: (name: string) => Promise<void>;
}

const defaultPersistence: TeardownPersistence = {
  deleteAll: deleteSecretBlob,
  deleteOne: deletePreset,
};

const teardownError = (message: string, cause: unknown): TeardownError =>
  new TeardownError({ cause, message });

export const resolveTeardownPromptValue = <A>(
  value: A | symbol,
  cancelled: (candidate: A | symbol) => candidate is symbol = isCancel,
): Effect.Effect<A> => (cancelled(value) ? Effect.interrupt : Effect.succeed(value));

const runPrompt = <A>(run: () => Promise<A | symbol>): Effect.Effect<A, TeardownError> =>
  Effect.tryPromise({
    catch: (cause) => teardownError('Teardown prompt failed', cause),
    try: run,
  }).pipe(Effect.flatMap(resolveTeardownPromptValue));

export const applyTeardownSelection = (
  selected: string,
  confirmed: boolean,
  persistence: TeardownPersistence = defaultPersistence,
): Effect.Effect<boolean, TeardownError> => {
  if (!confirmed) {
    return Effect.succeed(false);
  }
  return Effect.tryPromise({
    catch: (cause) => teardownError('Failed to remove stored presets', cause),
    try: async () => {
      if (selected === 'all') {
        await persistence.deleteAll();
        return;
      }
      await persistence.deleteOne(selected);
    },
  }).pipe(Effect.as(true));
};

export const teardownCommand = Command.make('teardown', {}, () =>
  Effect.gen(function* teardownCommandImpl() {
    showBanner();
    intro(frappeColors.text('Remove stored presets'));

    const existingPresets = yield* Effect.tryPromise({
      catch: (cause) => teardownError('Failed to list stored presets', cause),
      try: listPresets,
    });
    const currentDefault = yield* Effect.tryPromise({
      catch: (cause) => teardownError('Failed to load the default preset', cause),
      try: loadDefaultPreset,
    });

    if (existingPresets.length === 0) {
      outro(frappeColors.subtext1('No presets configured'));
      return;
    }

    const removeOptions = [
      { hint: 'Delete all presets', label: 'Remove all presets', value: 'all' },
      ...existingPresets.map((name) =>
        name === currentDefault
          ? { hint: '(current default)', label: `Remove ${name}`, value: name }
          : { label: `Remove ${name}`, value: name },
      ),
    ];

    const selected = yield* runPrompt(() =>
      select({ message: 'What would you like to remove?', options: removeOptions }),
    );
    const confirmed = yield* runPrompt(() =>
      confirm({
        initialValue: false,
        message:
          selected === 'all' ? 'Remove all stored presets?' : `Remove stored preset "${selected}"?`,
      }),
    );

    if (!confirmed) {
      outro(frappeColors.subtext1('No presets removed'));
      return;
    }

    const s = spinner();
    s.start('Removing presets...');
    yield* applyTeardownSelection(selected, true).pipe(
      Effect.tapError(() =>
        Effect.sync(() => {
          s.stop(theme.error('Failed to remove presets'));
        }),
      ),
    );
    s.stop(
      theme.success(selected === 'all' ? 'All presets removed' : `Preset "${selected}" removed`),
    );
    outro(frappeColors.subtext1('Done'));
  }).pipe(
    Effect.onInterrupt(() =>
      Effect.sync(() => {
        outro(frappeColors.subtext1('No presets removed'));
      }),
    ),
  ),
);
