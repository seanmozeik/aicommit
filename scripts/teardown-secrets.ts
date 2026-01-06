#!/usr/bin/env bun
/**
 * Teardown script to remove secrets from system credential store
 * Cross-platform: macOS Keychain, Linux libsecret, Windows Credential Manager
 */
import { deleteSecret } from '../src/lib/ai.js';

const SECRETS = [
  'AIC_CLOUDFLARE_ACCOUNT_ID',
  'AIC_CLOUDFLARE_API_TOKEN'
];

for (const key of SECRETS) {
  try {
    const deleted = await deleteSecret(key);
    if (deleted) {
      console.log(`✓ Removed ${key}`);
    } else {
      console.log(`✗ ${key} not found`);
    }
  } catch (err) {
    console.error(`✗ Failed to remove ${key}:`, err);
  }
}
