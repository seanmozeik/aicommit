#!/usr/bin/env bun
// scripts/migrate-secrets.ts
// One-off script to migrate from old individual keychain entries to new JSON blob

const OLD_SERVICE = 'com.aicommit.cli';
const NEW_SERVICE = 'com.aicommit.cli';
const NEW_CONFIG_KEY = 'AIC_CONFIG';

interface SecretsConfig {
  defaultProvider: 'cloudflare' | 'claude' | 'anthropic' | 'openai';
  providers: {
    cloudflare?: {
      accountId: string;
      apiToken: string;
    };
  };
}

async function migrate() {
  console.log('Migrating AIC secrets to JSON blob format...\n');

  // Read old keys
  let accountId: string | null = null;
  let apiToken: string | null = null;

  try {
    accountId = await Bun.secrets.get({
      name: 'AIC_CLOUDFLARE_ACCOUNT_ID',
      service: OLD_SERVICE
    });
  } catch {
    // Key doesn't exist
  }

  try {
    apiToken = await Bun.secrets.get({
      name: 'AIC_CLOUDFLARE_API_TOKEN',
      service: OLD_SERVICE
    });
  } catch {
    // Key doesn't exist
  }

  if (!accountId && !apiToken) {
    console.log('No old secrets found. Nothing to migrate.');
    process.exit(0);
  }

  if (!accountId || !apiToken) {
    console.log('Partial credentials found:');
    console.log(`  Account ID: ${accountId ? 'found' : 'missing'}`);
    console.log(`  API Token: ${apiToken ? 'found' : 'missing'}`);
    console.log('\nCannot migrate incomplete credentials. Run "aic setup" instead.');
    process.exit(1);
  }

  // Build new config
  const newConfig: SecretsConfig = {
    defaultProvider: 'cloudflare',
    providers: {
      cloudflare: {
        accountId,
        apiToken
      }
    }
  };

  // Save new config
  console.log('Creating new JSON blob config...');
  await Bun.secrets.set({
    name: NEW_CONFIG_KEY,
    service: NEW_SERVICE,
    value: JSON.stringify(newConfig)
  });
  console.log('  ✓ Saved AIC_CONFIG');

  // Delete old keys
  console.log('\nRemoving old individual keys...');

  const deletedAccountId = await Bun.secrets.delete({
    name: 'AIC_CLOUDFLARE_ACCOUNT_ID',
    service: OLD_SERVICE
  });
  console.log(`  ${deletedAccountId ? '✓' : '✗'} AIC_CLOUDFLARE_ACCOUNT_ID`);

  const deletedApiToken = await Bun.secrets.delete({
    name: 'AIC_CLOUDFLARE_API_TOKEN',
    service: OLD_SERVICE
  });
  console.log(`  ${deletedApiToken ? '✓' : '✗'} AIC_CLOUDFLARE_API_TOKEN`);

  console.log('\n✓ Migration complete!');
  console.log('  Default provider: cloudflare');
  console.log('  Configured providers: cloudflare');
}

migrate().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
