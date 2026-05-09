import { KEYCHAIN_ACCOUNT, KEYCHAIN_SERVICE } from './constants.js';

export interface Preset {
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly model: string;
  readonly contextWindow?: number;
}

interface SecretBlob {
  readonly presets: Record<string, Preset>;
  readonly defaultPreset?: string;
}

const isPreset = (value: unknown): value is Preset =>
  typeof value === 'object' &&
  value !== null &&
  'baseUrl' in value &&
  typeof Reflect.get(value, 'baseUrl') === 'string' &&
  'model' in value &&
  typeof Reflect.get(value, 'model') === 'string' &&
  (!('apiKey' in value) || typeof Reflect.get(value, 'apiKey') === 'string') &&
  (!('contextWindow' in value) || typeof Reflect.get(value, 'contextWindow') === 'number');

const isSecretBlob = (value: unknown): value is SecretBlob =>
  typeof value === 'object' &&
  value !== null &&
  'presets' in value &&
  typeof Reflect.get(value, 'presets') === 'object' &&
  Reflect.get(value, 'presets') !== null &&
  (!('defaultPreset' in value) || typeof Reflect.get(value, 'defaultPreset') === 'string') &&
  Object.values(Reflect.get(value, 'presets') as Record<string, unknown>).every(isPreset);

const readKeychainBlob = async (): Promise<SecretBlob> => {
  const raw = await Bun.secrets.get({ name: KEYCHAIN_ACCOUNT, service: KEYCHAIN_SERVICE });
  if (raw === null || raw.trim() === '') {
    return { presets: {} };
  }
  const parsed: unknown = JSON.parse(raw);
  if (!isSecretBlob(parsed)) {
    throw new Error(`${KEYCHAIN_SERVICE}/${KEYCHAIN_ACCOUNT} is not a valid aicommit secrets blob`);
  }
  return parsed;
};

const presetConfigured = async (name: string): Promise<boolean> => {
  const keychain = await readKeychainBlob();
  return name in keychain.presets;
};

const savePreset = async (name: string, preset: Preset): Promise<string> => {
  const blob = await readKeychainBlob();
  blob.presets[name] = preset;
  await Bun.secrets.set({
    name: KEYCHAIN_ACCOUNT,
    service: KEYCHAIN_SERVICE,
    value: JSON.stringify(blob),
  });
  return `${KEYCHAIN_SERVICE}/${KEYCHAIN_ACCOUNT}`;
};

const loadPreset = async (name: string): Promise<Preset> => {
  const keychain = await readKeychainBlob();
  const preset = keychain.presets[name];
  if (!preset) {
    throw new Error(`Preset "${name}" not found. Run: aic setup`);
  }
  return preset;
};

const deletePreset = async (name: string): Promise<void> => {
  const blob = await readKeychainBlob();
  delete blob.presets[name];
  // If deleting default preset, clear it
  if (blob.defaultPreset === name) {
    delete blob.defaultPreset;
  }
  await Bun.secrets.set({
    name: KEYCHAIN_ACCOUNT,
    service: KEYCHAIN_SERVICE,
    value: JSON.stringify(blob),
  });
};

const listPresets = async (): Promise<readonly string[]> => {
  const keychain = await readKeychainBlob();
  return Object.keys(keychain.presets);
};

const saveDefaultPreset = async (name: string): Promise<string> => {
  const blob = await readKeychainBlob();
  if (!(name in blob.presets)) {
    throw new Error(`Preset "${name}" does not exist`);
  }
  blob.defaultPreset = name;
  await Bun.secrets.set({
    name: KEYCHAIN_ACCOUNT,
    service: KEYCHAIN_SERVICE,
    value: JSON.stringify(blob),
  });
  return `${KEYCHAIN_SERVICE}/${KEYCHAIN_ACCOUNT}`;
};

const loadDefaultPreset = async (): Promise<string> => {
  const keychain = await readKeychainBlob();
  return keychain.defaultPreset ?? Object.keys(keychain.presets)[0] ?? '';
};

const deleteSecretBlob = async (): Promise<boolean> => {
  return Bun.secrets.delete({ name: KEYCHAIN_ACCOUNT, service: KEYCHAIN_SERVICE });
};

export type { Preset, SecretBlob };
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
