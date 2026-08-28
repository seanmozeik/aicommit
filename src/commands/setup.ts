import {
  confirm,
  intro,
  isCancel,
  log,
  note,
  outro,
  password,
  select,
  spinner,
  text,
} from '@clack/prompts';
import { Effect } from 'effect';
import { Command } from 'effect/unstable/cli';

import {
  CODEX_LUNA_CONTEXT_WINDOW,
  CODEX_LUNA_MODEL,
  listPresets,
  loadDefaultPreset,
  saveDefaultPreset,
  savePreset,
  type CodexCliPreset,
  type Preset,
  validatePresetName,
} from '../config/secrets';
import { SetupError } from '../errors/setup-error';
import { showBanner } from '../ui/banner';
import { frappeColors, theme } from '../ui/theme';
import { handleDeletePreset, handleListPresets, handleSetDefault } from './preset-actions';

type PresetKind = 'codex-luna' | 'custom';

interface PresetPersistence {
  readonly saveDefault: (name: string) => Promise<string>;
  readonly savePreset: (name: string, preset: Preset) => Promise<string>;
}

const defaultPersistence: PresetPersistence = { saveDefault: saveDefaultPreset, savePreset };

const setupError = (message: string, cause: unknown): SetupError =>
  new SetupError({ cause, message });

export const resolvePromptValue = <A>(
  value: A | symbol,
  cancelled: (candidate: A | symbol) => candidate is symbol = isCancel,
): Effect.Effect<A> => (cancelled(value) ? Effect.interrupt : Effect.succeed(value));

const runPrompt = <A>(run: () => Promise<A | symbol>): Effect.Effect<A, SetupError> =>
  Effect.tryPromise({ catch: (cause) => setupError('Setup prompt failed', cause), try: run }).pipe(
    Effect.flatMap((value) => resolvePromptValue(value)),
  );

const isLoopbackHost = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost' || normalized === '[::1]' || normalized.startsWith('127.');
};

export const validateCustomBaseUrl = (value: string | undefined): string | undefined => {
  const normalized = value?.trim() ?? '';
  if (normalized === '') {
    return 'Base URL is required';
  }
  if (!URL.canParse(normalized)) {
    return 'Invalid URL';
  }
  const parsed = new URL(normalized);
  if (parsed.protocol === 'https:') {
    return undefined;
  }
  if (parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname)) {
    return undefined;
  }
  if (parsed.protocol === 'http:') {
    return 'HTTP is permitted only for loopback endpoints';
  }
  return 'URL must use http:// or https://';
};

export const validateContextWindow = (value: string | undefined): string | undefined => {
  const normalized = value?.trim() ?? '';
  if (normalized === '') {
    return undefined;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && Number.isInteger(parsed) && parsed > 0
    ? undefined
    : 'Context window must be a positive whole number';
};

export const parseContextWindow = (value: string): number | undefined => {
  const normalized = value.trim();
  if (normalized === '') {
    return undefined;
  }
  const validationError = validateContextWindow(normalized);
  if (validationError !== undefined) {
    throw new TypeError(validationError);
  }
  return Number(normalized);
};

export const makeLunaPreset = (): CodexCliPreset => ({
  contextWindow: CODEX_LUNA_CONTEXT_WINDOW,
  model: CODEX_LUNA_MODEL,
  provider: 'codex-cli',
  reasoningEffort: 'medium',
  serviceTier: 'fast',
});

const promptAction = (hasPresets: boolean): Effect.Effect<string, SetupError> =>
  runPrompt(() =>
    select({
      message: 'What would you like to do?',
      options: [
        { label: 'Add a new preset', value: 'add' },
        ...(hasPresets
          ? [
              { label: 'List existing presets', value: 'list' },
              { label: 'Set default preset', value: 'default' },
              { label: 'Delete a preset', value: 'delete' },
            ]
          : []),
      ],
    }),
  );

const promptPresetKind = (): Effect.Effect<PresetKind, SetupError> =>
  runPrompt(() =>
    select({
      message: 'Choose a provider preset:',
      options: [
        {
          hint: 'Codex CLI, medium reasoning, fast mode',
          label: 'Codex GPT-5.6 Luna',
          value: 'codex-luna' as const,
        },
        {
          hint: 'OpenAI-compatible endpoint and model',
          label: 'Custom endpoint',
          value: 'custom' as const,
        },
      ],
    }),
  );

const promptPresetName = (existingPresets: readonly string[]): Effect.Effect<string, SetupError> =>
  runPrompt(() =>
    text({
      message: 'Preset name (e.g., luna, openrouter, local):',
      validate: (value): string | undefined => {
        const validationError = validatePresetName(value ?? '');
        if (validationError !== undefined) {
          return validationError;
        }
        return existingPresets.includes((value ?? '').trim())
          ? 'Preset name already exists'
          : undefined;
      },
    }),
  ).pipe(Effect.map((name) => name.trim()));

const promptApiKey = (): Effect.Effect<string, SetupError> =>
  runPrompt(() =>
    password({
      message: 'API Key:',
      validate: (value): string | undefined =>
        value === undefined || value.trim() === '' ? 'API Key is required' : undefined,
    }),
  ).pipe(Effect.map((apiKey) => apiKey.trim()));

const promptBaseUrl = (): Effect.Effect<string, SetupError> =>
  runPrompt(() =>
    text({
      message: 'Base URL (e.g., https://openrouter.ai/api/v1, http://localhost:1234/v1):',
      validate: validateCustomBaseUrl,
    }),
  ).pipe(Effect.map((baseUrl) => baseUrl.trim()));

const promptOptionalApiKey = (): Effect.Effect<string | undefined, SetupError> =>
  Effect.gen(function* promptOptionalApiKeyGen() {
    const required = yield* runPrompt(() =>
      confirm({ initialValue: false, message: 'Does this endpoint require an API key?' }),
    );
    return required ? yield* promptApiKey() : undefined;
  });

const promptModel = (): Effect.Effect<string, SetupError> =>
  runPrompt(() =>
    text({
      message: 'Model name (e.g., anthropic/claude-3.5-sonnet, gpt-4o-mini):',
      validate: (value): string | undefined =>
        value === undefined || value.trim() === '' ? 'Model name is required' : undefined,
    }),
  ).pipe(Effect.map((model) => model.trim()));

const promptContextWindow = (): Effect.Effect<number | undefined, SetupError> =>
  runPrompt(() =>
    text({
      defaultValue: '32000',
      message: 'Context window / max tokens (optional, default 32000):',
      validate: validateContextWindow,
    }),
  ).pipe(Effect.map(parseContextWindow));

const promptCustomPreset = (): Effect.Effect<Preset, SetupError> =>
  Effect.gen(function* promptCustomPresetGen() {
    const baseUrl = yield* promptBaseUrl();
    const apiKey = yield* promptOptionalApiKey();
    const model = yield* promptModel();
    const contextWindow = yield* promptContextWindow();
    return {
      ...(apiKey !== undefined && { apiKey }),
      baseUrl,
      ...(contextWindow !== undefined && { contextWindow }),
      model,
    };
  });

const promptPreset = (kind: PresetKind): Effect.Effect<Preset, SetupError> =>
  kind === 'codex-luna' ? Effect.succeed(makeLunaPreset()) : promptCustomPreset();

export const persistConfiguredPreset = (
  name: string,
  preset: Preset,
  setAsDefault: boolean,
  persistence: PresetPersistence = defaultPersistence,
): Effect.Effect<void, SetupError> =>
  Effect.gen(function* persistConfiguredPresetGen() {
    yield* Effect.tryPromise({
      catch: (cause) => setupError(`Failed to save preset "${name}"`, cause),
      try: () => persistence.savePreset(name, preset),
    });
    if (setAsDefault) {
      yield* Effect.tryPromise({
        catch: (cause) => setupError(`Failed to set default preset "${name}"`, cause),
        try: () => persistence.saveDefault(name),
      });
    }
  });

const promptDefaultChoice = (shouldAsk: boolean): Effect.Effect<boolean, SetupError> =>
  shouldAsk
    ? runPrompt(() => confirm({ initialValue: true, message: 'Set as default preset?' }))
    : Effect.succeed(false);

const addPreset = (
  existingPresets: readonly string[],
  currentDefault: string,
): Effect.Effect<void, SetupError> =>
  Effect.gen(function* addPresetGen() {
    const kind = yield* promptPresetKind();
    const presetName = yield* promptPresetName(existingPresets);
    const preset = yield* promptPreset(kind);
    const setAsDefault = yield* promptDefaultChoice(
      existingPresets.length === 0 || currentDefault === '',
    );
    const progress = spinner();
    progress.start('Saving preset...');
    yield* persistConfiguredPreset(presetName, preset, setAsDefault).pipe(
      Effect.tapError((error) =>
        Effect.sync(() => {
          progress.stop(theme.error('Failed to save preset'));
          log.error(error.message);
        }),
      ),
    );
    progress.stop(theme.success('Preset saved'));
    const suffix = setAsDefault
      ? 'saved and set as default. Run aic to generate commit messages.'
      : `saved. Run aic --preset ${presetName} to use it.`;
    outro(theme.success(`Preset "${presetName}" ${suffix}`));
  });

const handleSetupAction = (
  action: string,
  existingPresets: readonly string[],
  currentDefault: string,
): Effect.Effect<void, SetupError> => {
  if (action === 'list') {
    handleListPresets(existingPresets, currentDefault);
    return Effect.void;
  }
  if (action === 'default') {
    return handleSetDefault(existingPresets, currentDefault);
  }
  if (action === 'delete') {
    return handleDeletePreset(existingPresets, currentDefault);
  }
  return addPreset(existingPresets, currentDefault);
};

const setupProgram = Effect.gen(function* setupProgramGen() {
  showBanner();
  intro(frappeColors.text('Setup AI Presets'));
  note(
    'Built-in presets: claude (requires Claude CLI), codex (requires Codex CLI)\nThe Luna preset also uses Codex CLI and its existing authentication',
    'Info',
  );
  const existingPresets = yield* Effect.tryPromise({
    catch: (cause) => setupError('Failed to list presets', cause),
    try: listPresets,
  });
  const currentDefault = yield* Effect.tryPromise({
    catch: (cause) => setupError('Failed to load the default preset', cause),
    try: loadDefaultPreset,
  });
  const action = yield* promptAction(existingPresets.length > 0);
  return yield* handleSetupAction(action, existingPresets, currentDefault);
}).pipe(
  Effect.onInterrupt(() =>
    Effect.sync(() => {
      outro(frappeColors.subtext1('Setup cancelled'));
    }),
  ),
);

export const setupCommand = Command.make('setup', {}, () => setupProgram);
