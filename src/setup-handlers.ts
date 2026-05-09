import { confirm, log, outro, select } from '@clack/prompts';
import { Effect } from 'effect';

import { saveDefaultPreset } from './secrets';
import { frappeColors, theme } from './ui/theme';

export const handleListPresets = (
  existingPresets: readonly string[],
  currentDefault: string,
): void => {
  if (existingPresets.length === 0) {
    outro(frappeColors.subtext1('No presets configured'));
    return;
  }
  for (const presetName of existingPresets) {
    const isDefault = presetName === currentDefault ? ' (default)' : '';
    log.success(`  ${presetName}${isDefault}`);
  }
  outro(frappeColors.subtext1('Done'));
};

export const handleSetDefault = (
  existingPresets: readonly string[],
  currentDefault: string,
): Effect.Effect<void, Error> =>
  Effect.gen(function* handleSetDefaultImpl() {
    const selected = yield* Effect.tryPromise({
      catch: (error) =>
        new Error(`Setup cancelled: ${error instanceof Error ? error.message : String(error)}`),
      try: async () => {
        const result = await select({
          message: 'Select default preset:',
          options: existingPresets.map((name) => ({
            hint: name === currentDefault ? '(current default)' : undefined,
            label: name,
            value: name,
          })),
        });
        if (typeof result === 'symbol') {
          throw new TypeError('Cancelled');
        }
        return result;
      },
    });
    yield* Effect.tryPromise(() => saveDefaultPreset(selected));
    outro(theme.success(`Default preset set to "${selected}"`));
  });

export const handleDeletePreset = (
  existingPresets: readonly string[],
  currentDefault: string,
): Effect.Effect<void, Error> =>
  Effect.gen(function* handleDeletePresetImpl() {
    const selected = yield* Effect.tryPromise({
      catch: (error) =>
        new Error(`Setup cancelled: ${error instanceof Error ? error.message : String(error)}`),
      try: async () => {
        const result = await select({
          message: 'Select preset to delete:',
          options: existingPresets.map((name) => ({
            hint: name === currentDefault ? '(current default)' : undefined,
            label: name,
            value: name,
          })),
        });
        if (typeof result === 'symbol') {
          throw new TypeError('Cancelled');
        }
        return result;
      },
    });
    const confirmResult = yield* Effect.tryPromise({
      catch: (error) =>
        new Error(`Setup cancelled: ${error instanceof Error ? error.message : String(error)}`),
      try: async () => {
        const result = await confirm({
          initialValue: false,
          message: `Delete preset "${selected}"?`,
        });
        if (typeof result === 'symbol') {
          throw new TypeError('Cancelled');
        }
        return result;
      },
    });
    if (!confirmResult) {
      outro(frappeColors.subtext1('Cancelled'));
      return;
    }
    yield* Effect.tryPromise({
      catch: (error) =>
        new Error(
          `Failed to delete preset: ${error instanceof Error ? error.message : String(error)}`,
        ),
      try: () => import('./secrets.js').then((m) => m.deletePreset(selected)),
    });
    outro(theme.success(`Preset "${selected}" deleted`));
  });
