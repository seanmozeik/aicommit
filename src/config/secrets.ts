import { Option, Schema } from 'effect';

import { KEYCHAIN_ACCOUNT, KEYCHAIN_SERVICE } from './constants';

export const CODEX_LUNA_CONTEXT_WINDOW = 272_000;
export const CODEX_LUNA_MODEL = 'gpt-5.6-luna';

export interface OpenAiCompatiblePreset {
  readonly apiKey?: string;
  readonly baseUrl: string;
  readonly contextWindow?: number;
  readonly model: string;
}

export interface CodexCliPreset {
  readonly contextWindow: number;
  readonly model: string;
  readonly provider: 'codex-cli';
  readonly reasoningEffort: 'low';
  readonly serviceTier: 'fast';
}

export type Preset = CodexCliPreset | OpenAiCompatiblePreset;

export interface SecretBlob {
  readonly defaultPreset?: string;
  readonly presets: Record<string, Preset>;
}

const positiveInteger = Schema.Int.check(Schema.isGreaterThan(0));

const openAiCompatiblePresetSchema = Schema.Struct({
  apiKey: Schema.optionalKey(Schema.String),
  baseUrl: Schema.String,
  contextWindow: Schema.optionalKey(positiveInteger),
  model: Schema.String,
});
const codexCliPresetSchema = Schema.Struct({
  contextWindow: positiveInteger,
  model: Schema.String,
  provider: Schema.Literal('codex-cli'),
  reasoningEffort: Schema.Literal('low'),
  serviceTier: Schema.Literal('fast'),
});
const legacyOpenAiLunaPresetSchema = Schema.Struct({
  apiKey: Schema.String,
  baseUrl: Schema.String,
  contextWindow: positiveInteger,
  model: Schema.Literal(CODEX_LUNA_MODEL),
  provider: Schema.Literal('openai'),
  reasoningEffort: Schema.Literal('medium'),
  serviceTier: Schema.Literal('fast'),
});
const legacyCodexMediumPresetSchema = Schema.Struct({
  contextWindow: positiveInteger,
  model: Schema.Literal(CODEX_LUNA_MODEL),
  provider: Schema.Literal('codex-cli'),
  reasoningEffort: Schema.Literal('medium'),
  serviceTier: Schema.Literal('fast'),
});

export const presetSchema = Schema.Union([codexCliPresetSchema, openAiCompatiblePresetSchema]);
const storedPresetSchema = Schema.Union([
  legacyOpenAiLunaPresetSchema,
  legacyCodexMediumPresetSchema,
  presetSchema,
]);
type StoredPreset = typeof storedPresetSchema.Type;
const decodeStoredPreset = Schema.decodeUnknownOption(storedPresetSchema);
const storedSecretBlobSchema = Schema.Struct({
  defaultPreset: Schema.optionalKey(Schema.String),
  presets: Schema.Record(Schema.String, storedPresetSchema),
});
const decodeStoredSecretBlob = Schema.decodeUnknownOption(storedSecretBlobSchema);

const migrateStoredPreset = (preset: StoredPreset): Preset =>
  'provider' in preset && (preset.provider === 'openai' || preset.reasoningEffort === 'medium')
    ? {
        contextWindow: CODEX_LUNA_CONTEXT_WINDOW,
        model: CODEX_LUNA_MODEL,
        provider: 'codex-cli',
        reasoningEffort: 'low',
        serviceTier: 'fast',
      }
    : preset;

export const isCodexCliPreset = (preset: Preset): preset is CodexCliPreset => 'provider' in preset;

export const validatePresetName = (name: string): string | undefined => {
  const normalized = name.trim();
  if (normalized === '') {
    return 'Preset name is required';
  }
  if (normalized === '__proto__' || normalized === 'constructor' || normalized === 'prototype') {
    return 'Preset name is reserved';
  }
  return undefined;
};

export const hasOwnPreset = (presets: object, name: string): boolean =>
  Object.hasOwn(presets, name);

export const decodeSecretBlobValue = (value: unknown): SecretBlob | null => {
  const decoded = decodeStoredSecretBlob(value);
  if (Option.isNone(decoded)) {
    return null;
  }
  const presets = Object.fromEntries(
    Object.entries(decoded.value.presets).map(([name, preset]) => [
      name,
      migrateStoredPreset(preset),
    ]),
  );
  return decoded.value.defaultPreset === undefined
    ? { presets }
    : { defaultPreset: decoded.value.defaultPreset, presets };
};

export const decodePresetValue = (value: unknown): Preset | null => {
  const decoded = decodeStoredPreset(value);
  return Option.isSome(decoded) ? migrateStoredPreset(decoded.value) : null;
};

const requireValidPresetName = (name: string): string => {
  const normalized = name.trim();
  const validationError = validatePresetName(normalized);
  if (validationError !== undefined) {
    throw new TypeError(validationError);
  }
  return normalized;
};

const copyPresets = (presets: Readonly<Record<string, Preset>>): Record<string, Preset> => {
  const copy: Record<string, Preset> = {};
  for (const [name, preset] of Object.entries(presets)) {
    Object.defineProperty(copy, name, {
      configurable: true,
      enumerable: true,
      value: preset,
      writable: true,
    });
  }
  return copy;
};

const readKeychainBlob = async (): Promise<SecretBlob> => {
  const raw = await Bun.secrets.get({ name: KEYCHAIN_ACCOUNT, service: KEYCHAIN_SERVICE });
  if (raw === null || raw.trim() === '') {
    return { presets: {} };
  }
  const decoded = decodeSecretBlobValue(JSON.parse(raw));
  if (decoded === null) {
    throw new Error(`${KEYCHAIN_SERVICE}/${KEYCHAIN_ACCOUNT} is not a valid aicommit secrets blob`);
  }
  return { ...decoded, presets: copyPresets(decoded.presets) };
};

const presetConfigured = async (name: string): Promise<boolean> => {
  const normalized = requireValidPresetName(name);
  const keychain = await readKeychainBlob();
  return hasOwnPreset(keychain.presets, normalized);
};

const savePreset = async (name: string, preset: Preset): Promise<string> => {
  const normalized = requireValidPresetName(name);
  const validatedPreset = decodePresetValue(preset);
  if (validatedPreset === null) {
    throw new TypeError('Preset is invalid');
  }
  const blob = await readKeychainBlob();
  const presets = copyPresets(blob.presets);
  Object.defineProperty(presets, normalized, {
    configurable: true,
    enumerable: true,
    value: validatedPreset,
    writable: true,
  });
  await Bun.secrets.set({
    name: KEYCHAIN_ACCOUNT,
    service: KEYCHAIN_SERVICE,
    value: JSON.stringify({ ...blob, presets }),
  });
  return `${KEYCHAIN_SERVICE}/${KEYCHAIN_ACCOUNT}`;
};

const loadPreset = async (name: string): Promise<Preset> => {
  const normalized = requireValidPresetName(name);
  const keychain = await readKeychainBlob();
  if (!hasOwnPreset(keychain.presets, normalized)) {
    throw new Error(`Preset "${normalized}" not found. Run: aic setup`);
  }
  const preset = keychain.presets[normalized];
  if (preset === undefined) {
    throw new Error(`Preset "${normalized}" not found. Run: aic setup`);
  }
  return preset;
};

const deletePreset = async (name: string): Promise<void> => {
  const normalized = requireValidPresetName(name);
  const blob = await readKeychainBlob();
  const remainingPresets = copyPresets(blob.presets);
  Reflect.deleteProperty(remainingPresets, normalized);
  const newBlob: SecretBlob =
    blob.defaultPreset !== normalized && blob.defaultPreset !== undefined
      ? { defaultPreset: blob.defaultPreset, presets: remainingPresets }
      : { presets: remainingPresets };

  await Bun.secrets.set({
    name: KEYCHAIN_ACCOUNT,
    service: KEYCHAIN_SERVICE,
    value: JSON.stringify(newBlob),
  });
};

const listPresets = async (): Promise<readonly string[]> => {
  const keychain = await readKeychainBlob();
  return Object.keys(keychain.presets);
};

const saveDefaultPreset = async (name: string): Promise<string> => {
  const normalized = requireValidPresetName(name);
  const blob = await readKeychainBlob();
  if (!hasOwnPreset(blob.presets, normalized)) {
    throw new Error(`Preset "${normalized}" does not exist`);
  }
  const newBlob: SecretBlob = { defaultPreset: normalized, presets: copyPresets(blob.presets) };
  await Bun.secrets.set({
    name: KEYCHAIN_ACCOUNT,
    service: KEYCHAIN_SERVICE,
    value: JSON.stringify(newBlob),
  });
  return `${KEYCHAIN_SERVICE}/${KEYCHAIN_ACCOUNT}`;
};

const loadDefaultPreset = async (): Promise<string> => {
  const keychain = await readKeychainBlob();
  if (keychain.defaultPreset !== undefined && keychain.defaultPreset !== '') {
    return keychain.defaultPreset;
  }
  const [firstPreset] = Object.keys(keychain.presets);
  return firstPreset ?? '';
};

const deleteSecretBlob = (): Promise<boolean> =>
  Bun.secrets.delete({ name: KEYCHAIN_ACCOUNT, service: KEYCHAIN_SERVICE });

export {
  deletePreset,
  deleteSecretBlob,
  listPresets,
  loadDefaultPreset,
  loadPreset,
  presetConfigured,
  saveDefaultPreset,
  savePreset,
};
