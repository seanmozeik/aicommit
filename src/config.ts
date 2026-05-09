import { configJsonPath, configTomlPath } from './paths.js';

interface AicUserConfig {
  /** Default preset name (optional, falls back to keychain default) */
  readonly defaultPreset?: string;
}

interface ResolvedUserConfig {
  readonly config: AicUserConfig;
  /** `config.toml`, `config.json`, or `null` when missing (defaults only). */
  readonly source: 'config.toml' | 'config.json' | null;
}

const defaults: AicUserConfig = {};

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeConfig = (raw: Record<string, unknown>): AicUserConfig => {
  const { defaultPreset } = raw;
  return {
    defaultPreset:
      typeof defaultPreset === 'string' && defaultPreset !== '' ? defaultPreset : undefined,
  };
};

/**
 * Loads `~/.config/aicommit/config.toml` if present, otherwise `config.json`.
 * Uses {@link Bun.TOML.parse} for TOML. Missing files fall back to defaults.
 */
const loadUserConfig = async (): Promise<ResolvedUserConfig> => {
  const tomlFile = Bun.file(configTomlPath());
  if (await tomlFile.exists()) {
    const parsed: unknown = Bun.TOML.parse(await tomlFile.text());
    if (!isPlainRecord(parsed)) {
      throw new Error('config.toml must parse to a table');
    }
    return { config: normalizeConfig(parsed), source: 'config.toml' };
  }
  const jsonFile = Bun.file(configJsonPath());
  if (await jsonFile.exists()) {
    const parsed: unknown = await jsonFile.json();
    if (!isPlainRecord(parsed)) {
      throw new Error('config.json must contain a JSON object');
    }
    return { config: normalizeConfig(parsed), source: 'config.json' };
  }
  return { config: defaults, source: null };
};

export type { AicUserConfig, ResolvedUserConfig };
export { loadUserConfig };
