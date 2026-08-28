import { confirm, isCancel, log, outro, select } from '@clack/prompts';
import { Effect } from 'effect';

import { deletePreset, saveDefaultPreset } from '../config/secrets';
import { SetupError } from '../errors/setup-error';
import { frappeColors, theme } from '../ui/theme';

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
): Effect.Effect<void, SetupError> =>
  Effect.gen(function* handleSetDefaultImpl() {
    const selected = yield* Effect.tryPromise({
      catch: (cause) => new SetupError({ cause, message: 'Failed to select the default preset' }),
      try: () =>
        select({
          message: 'Select default preset:',
          options: existingPresets.map((name) =>
            name === currentDefault
              ? { hint: '(current default)', label: name, value: name }
              : { label: name, value: name },
          ),
        }),
    });
    if (!isCancel(selected)) {
      yield* Effect.tryPromise({
        catch: (cause) => new SetupError({ cause, message: 'Failed to set the default preset' }),
        try: () => saveDefaultPreset(selected),
      });
      outro(theme.success(`Default preset set to "${selected}"`));
      return yield* Effect.void;
    }
    return yield* Effect.interrupt;
  });

export const handleDeletePreset = (
  existingPresets: readonly string[],
  currentDefault: string,
): Effect.Effect<void, SetupError> =>
  Effect.gen(function* handleDeletePresetImpl() {
    const selected = yield* Effect.tryPromise({
      catch: (cause) => new SetupError({ cause, message: 'Failed to select a preset' }),
      try: () =>
        select({
          message: 'Select preset to delete:',
          options: existingPresets.map((name) =>
            name === currentDefault
              ? { hint: '(current default)', label: name, value: name }
              : { label: name, value: name },
          ),
        }),
    });
    if (isCancel(selected)) {
      return yield* Effect.interrupt;
    }
    const confirmResult = yield* Effect.tryPromise({
      catch: (cause) => new SetupError({ cause, message: 'Failed to confirm preset deletion' }),
      try: () => confirm({ initialValue: false, message: `Delete preset "${selected}"?` }),
    });
    if (isCancel(confirmResult)) {
      return yield* Effect.interrupt;
    }
    if (confirmResult) {
      yield* Effect.tryPromise({
        catch: (cause) => new SetupError({ cause, message: 'Failed to delete preset' }),
        try: () => deletePreset(selected),
      });
      outro(theme.success(`Preset "${selected}" deleted`));
    } else {
      outro(frappeColors.subtext1('Cancelled'));
    }
    return yield* Effect.void;
  });
