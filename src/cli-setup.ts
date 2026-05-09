import * as p from '@clack/prompts';
import { Effect } from 'effect';
import { Command } from 'effect/unstable/cli';

import type { Preset } from './secrets.js';
import { listPresets, loadDefaultPreset, saveDefaultPreset, savePreset } from './secrets.js';
import { showBanner } from './ui/banner.js';
import { frappeColors, theme } from './ui/theme.js';

export const setupCommand = Command.make('setup', {}, () =>
  Effect.gen(function* setupCommand() {
    showBanner();
    p.intro(frappeColors.text('Setup AI Presets'));
    p.note(
      'Built-in presets: claude (requires Claude CLI installed)\nUse --preset claude or set it as default',
      'Info',
    );

    const existingPresets = yield* Effect.tryPromise(() => listPresets());
    const currentDefault = yield* Effect.tryPromise(() => loadDefaultPreset());

    // Ask what action to take
    const action = yield* Effect.tryPromise({
      catch: (error) => new Error(`Setup cancelled: ${error}`),
      try: () =>
        p.select({
          message: 'What would you like to do?',
          options: [
            { label: 'Add a new preset', value: 'add' },
            ...(existingPresets.length > 0
              ? [
                  { label: 'List existing presets', value: 'list' },
                  { label: 'Set default preset', value: 'default' },
                  { label: 'Delete a preset', value: 'delete' },
                ]
              : []),
          ],
        }) as Promise<string>,
    });

    if (action === 'list') {
      if (existingPresets.length === 0) {
        p.outro(frappeColors.subtext1('No presets configured'));
        return;
      }
      for (const presetName of existingPresets) {
        const isDefault = presetName === currentDefault ? ' (default)' : '';
        p.log.success(`  ${presetName}${isDefault}`);
      }
      p.outro(frappeColors.subtext1('Done'));
      return;
    }

    if (action === 'default') {
      if (existingPresets.length === 0) {
        p.outro(theme.error('No presets configured. Add a preset first.'));
        return;
      }
      const selected = yield* Effect.tryPromise({
        catch: (error) => new Error(`Setup cancelled: ${error}`),
        try: () =>
          p.select({
            message: 'Select default preset:',
            options: existingPresets.map((name) => ({
              hint: name === currentDefault ? '(current default)' : undefined,
              label: name,
              value: name,
            })),
          }) as Promise<string>,
      });
      yield* Effect.tryPromise(() => saveDefaultPreset(selected));
      p.outro(theme.success(`Default preset set to "${selected}"`));
      return;
    }

    if (action === 'delete') {
      if (existingPresets.length === 0) {
        p.outro(theme.error('No presets configured.'));
        return;
      }
      const selected = yield* Effect.tryPromise({
        catch: (error) => new Error(`Setup cancelled: ${error}`),
        try: () =>
          p.select({
            message: 'Select preset to delete:',
            options: existingPresets.map((name) => ({
              hint: name === currentDefault ? '(current default)' : undefined,
              label: name,
              value: name,
            })),
          }) as Promise<string>,
      });
      const confirm = yield* Effect.tryPromise({
        catch: (error) => new Error(`Setup cancelled: ${error}`),
        try: () =>
          p.confirm({
            initialValue: false,
            message: `Delete preset "${selected}"?`,
          }) as Promise<boolean>,
      });
      if (!confirm) {
        p.outro(frappeColors.subtext1('Cancelled'));
        return;
      }
      yield* Effect.tryPromise({
        catch: (error) => new Error(`Failed to delete preset: ${error}`),
        try: () => import('./secrets.js').then((m) => m.deletePreset(selected)),
      });
      p.outro(theme.success(`Preset "${selected}" deleted`));
      return;
    }

    // Add new preset
    const presetName = yield* Effect.tryPromise({
      catch: (error) => new Error(`Setup cancelled: ${error}`),
      try: () =>
        p.text({
          message: 'Preset name (e.g., openrouter, local, openai):',
          validate: (v) => {
            if (!v?.trim()) {
              return 'Preset name is required';
            }
            if (existingPresets.includes(v.trim())) {
              return 'Preset name already exists';
            }
            return;
          },
        }) as Promise<string>,
    });

    const baseUrl = yield* Effect.tryPromise({
      catch: (error) => new Error(`Setup cancelled: ${error}`),
      try: () =>
        p.text({
          message: 'Base URL (e.g., https://openrouter.ai/api/v1, http://localhost:1234/v1):',
          validate: (v) => {
            if (!v?.trim()) {
              return 'Base URL is required';
            }
            if (!v.includes('://')) {
              return 'Invalid URL (must include http:// or https://)';
            }
            return;
          },
        }) as Promise<string>,
    });

    const hasApiKey = yield* Effect.tryPromise({
      catch: (error) => new Error(`Setup cancelled: ${error}`),
      try: () =>
        p.confirm({
          initialValue: false,
          message: 'Does this endpoint require an API key?',
        }) as Promise<boolean>,
    });

    let apiKey;
    if (hasApiKey) {
      apiKey = yield* Effect.tryPromise({
        catch: (error) => new Error(`Setup cancelled: ${error}`),
        try: () =>
          p.password({
            message: 'API Key:',
            validate: (v) => (v?.trim() ? undefined : 'API Key is required'),
          }) as Promise<string>,
      });
    }

    const model = yield* Effect.tryPromise({
      catch: (error) => new Error(`Setup cancelled: ${error}`),
      try: () =>
        p.text({
          message: 'Model name (e.g., anthropic/claude-3.5-sonnet, gpt-4o-mini):',
          validate: (v) => (v?.trim() ? undefined : 'Model name is required'),
        }) as Promise<string>,
    });

    const contextWindow = yield* Effect.tryPromise({
      catch: (error) => new Error(`Setup cancelled: ${error}`),
      try: () =>
        p.text({
          defaultValue: '256',
          message: 'Context window / max tokens (optional, default 256):',
        }) as Promise<string>,
    });

    const preset: Preset = {
      apiKey: apiKey?.trim(),
      baseUrl: baseUrl.trim(),
      contextWindow: contextWindow.trim() ? Number.parseInt(contextWindow.trim(), 10) : undefined,
      model: model.trim(),
    };

    const s = p.spinner();
    s.start('Saving preset...');

    try {
      yield* Effect.tryPromise(() => savePreset(presetName.trim(), preset));
      s.stop(theme.success('Preset saved'));

      // Ask if this should be the default
      if (existingPresets.length === 0 || currentDefault === '') {
        const setAsDefault = yield* Effect.tryPromise({
          catch: (error) => new Error(`Setup cancelled: ${error}`),
          try: () =>
            p.confirm({
              initialValue: true,
              message: 'Set as default preset?',
            }) as Promise<boolean>,
        });
        if (setAsDefault) {
          yield* Effect.tryPromise(() => saveDefaultPreset(presetName.trim()));
          p.outro(
            theme.success(
              `Preset "${presetName}" saved and set as default. Run aic to generate commit messages.`,
            ),
          );
        } else {
          p.outro(
            theme.success(
              `Preset "${presetName}" saved. Run aic --preset ${presetName} to use it.`,
            ),
          );
        }
      } else {
        p.outro(
          theme.success(`Preset "${presetName}" saved. Run aic --preset ${presetName} to use it.`),
        );
      }
    } catch (error) {
      s.stop(theme.error('Failed to save preset'));
      p.log.error(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }),
);
