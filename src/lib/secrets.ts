// src/lib/secrets.ts

import type { SecretsConfig } from './config.js';

const SECRETS_SERVICE = 'com.aicommit.cli';
const CONFIG_KEY = 'AIC_CONFIG';

// In-memory cache to avoid multiple keychain prompts per process
let configCache: SecretsConfig | null | undefined = undefined;

/**
 * Get config from keychain (single prompt, cached)
 */
export async function getConfig(): Promise<SecretsConfig | null> {
  if (configCache !== undefined) {
    return configCache;
  }

  // Check environment variable
  const envValue = process.env[CONFIG_KEY];
  if (envValue) {
    try {
      configCache = JSON.parse(envValue) as SecretsConfig;
      return configCache;
    } catch {
      // Invalid JSON in env var
    }
  }

  // Try system credential store
  try {
    const value = await Bun.secrets.get({
      name: CONFIG_KEY,
      service: SECRETS_SERVICE
    });
    if (value) {
      configCache = JSON.parse(value) as SecretsConfig;
      return configCache;
    }
    configCache = null;
    return null;
  } catch {
    configCache = null;
    return null;
  }
}

/**
 * Save config to keychain
 */
export async function setConfig(config: SecretsConfig): Promise<void> {
  try {
    await Bun.secrets.set({
      name: CONFIG_KEY,
      service: SECRETS_SERVICE,
      value: JSON.stringify(config)
    });
    configCache = config;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (process.platform === 'linux' && msg.includes('libsecret')) {
      throw new Error(
        'libsecret not found. Install it with:\n' +
          '  Ubuntu/Debian: sudo apt install libsecret-1-0\n' +
          '  Fedora/RHEL:   sudo dnf install libsecret\n' +
          '  Arch:          sudo pacman -S libsecret\n' +
          'Or use environment variables instead.'
      );
    }
    throw err;
  }
}

/**
 * Delete config from keychain
 */
export async function deleteConfig(): Promise<boolean> {
  configCache = undefined;
  return await Bun.secrets.delete({
    name: CONFIG_KEY,
    service: SECRETS_SERVICE
  });
}

/**
 * Get the secrets service name (for external tools)
 */
export function getSecretsService(): string {
  return SECRETS_SERVICE;
}
