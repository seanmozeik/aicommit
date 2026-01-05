#!/usr/bin/env bun
/**
 * Setup script to store secrets from .env file to system credential store
 * Cross-platform: macOS Keychain, Linux libsecret, Windows Credential Manager
 */
import { setSecret } from '../src/lib/ai.js';
import { existsSync, readFileSync } from 'fs';

const ENV_FILE = '.env';

if (!existsSync(ENV_FILE)) {
  console.error('Error: .env file not found');
  console.error('Create one with AIC_CLOUDFLARE_ACCOUNT_ID and AIC_CLOUDFLARE_API_TOKEN');
  process.exit(1);
}

const content = readFileSync(ENV_FILE, 'utf-8');
const lines = content.split('\n');
let stored = 0;

for (const line of lines) {
  const trimmed = line.trim();

  // Skip empty lines and comments
  if (!trimmed || trimmed.startsWith('#')) continue;

  const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (!match) continue;

  const [, key, rawValue] = match;
  // Remove surrounding quotes if present
  const value = rawValue.replace(/^["']|["']$/g, '');

  try {
    await setSecret(key, value);
    console.log(`✓ Stored ${key}`);
    stored++;
  } catch (err) {
    console.error(`✗ Failed to store ${key}:`, err);
  }
}

if (stored > 0) {
  console.log(`\nDone! Stored ${stored} secret(s). You can now delete .env`);
} else {
  console.log('\nNo secrets found in .env file');
}
