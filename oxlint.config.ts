import {
  composeDeClankConfig,
  coreBaseConfig,
  effectConfig,
  loadPersonalData,
} from '@seanmozeik/de-clank/config';
import { defineConfig } from 'oxlint';

const projectConfig = defineConfig({
  env: { es2024: true, node: true },
  globals: { Bun: 'readonly' },
  ignorePatterns: ['node_modules', 'dist', 'build', '.wrangler', 'coverage', 'docs'],
  rules: {
    'de-clank/no-personal-test-data': ['error', loadPersonalData()],
    'de-clank/no-test-only-production-code': [
      'error',
      { productionEntrypoints: ['scripts/build.ts', 'src/cli.ts', 'src/index.ts'] },
    ],
  },
  overrides: [
    {
      // Public .aic files intentionally store shell command strings for backward compatibility.
      files: ['src/aic-script.ts'],
      rules: { 'de-clank/no-shell-string-execution': 'off' },
    },
  ],
});

export default composeDeClankConfig(coreBaseConfig, effectConfig, projectConfig);
