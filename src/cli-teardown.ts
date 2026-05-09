import { intro, outro, select, spinner, log } from '@clack/prompts';
import { Effect } from 'effect';
import { Command } from 'effect/unstable/cli';

import { deletePreset, deleteSecretBlob, listPresets, loadDefaultPreset } from './secrets.js';
import { showBanner } from './ui/banner.js';
import { frappeColors, theme } from './ui/theme.js';

export const teardownCommand = Command.make('teardown', {}, () =>
  Effect.gen(function* teardownCommandImpl() {
    showBanner();
    intro(frappeColors.text('Remove stored presets'));

    const existingPresets = yield* Effect.tryPromise(() => listPresets());
    const currentDefault = yield* Effect.tryPromise(() => loadDefaultPreset());

    if (existingPresets.length === 0) {
      outro(frappeColors.subtext1('No presets configured'));
      return;
    }

    const removeOptions = [
      { hint: 'Delete all presets', label: 'Remove all presets', value: 'all' },
      ...existingPresets.map((name) => ({
        hint: name === currentDefault ? '(current default)' : undefined,
        label: `Remove ${name}`,
        value: name,
      })),
    ];

    const selected = yield* Effect.tryPromise({
      catch: (error) => new Error(`Teardown cancelled: ${error}`),
      try: () =>
        select({
          message: 'What would you like to remove?',
          options: removeOptions,
        }) as Promise<string>,
    });

    const s = spinner();
    s.start('Removing presets...');

    try {
      if (selected === 'all') {
        yield* Effect.tryPromise(() => deleteSecretBlob());
        s.stop(theme.success('All presets removed'));
      } else {
        yield* Effect.tryPromise({
          catch: (error) => new Error(`Failed to remove preset: ${error}`),
          try: () => deletePreset(selected),
        });
        s.stop(theme.success(`Preset "${selected}" removed`));
      }
      outro(frappeColors.subtext1('Done'));
    } catch (error) {
      s.stop(theme.error('Failed to remove presets'));
      log.error(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }),
);
