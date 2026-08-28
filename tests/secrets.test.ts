import * as BunTest from 'bun:test';

import {
  decodePresetValue,
  decodeSecretBlobValue,
  hasOwnPreset,
  isCodexCliPreset,
  validatePresetName,
} from '../src/config/secrets';

const customApiPreset = {
  baseUrl: 'http://localhost:1234/v1',
  contextWindow: 32_000,
  model: 'local-model',
};

const codexLunaPreset = {
  contextWindow: 272_000,
  model: 'gpt-5.6-luna',
  provider: 'codex-cli' as const,
  reasoningEffort: 'low' as const,
  serviceTier: 'fast' as const,
};

BunTest.test('preset schema decodes custom APIs and Codex CLI Luna', () => {
  const custom = decodeSecretBlobValue({ presets: { local: customApiPreset } });
  const luna = decodePresetValue(codexLunaPreset);

  BunTest.expect(custom?.presets['local']).toEqual(customApiPreset);
  BunTest.expect(luna).toEqual(codexLunaPreset);
  BunTest.expect(luna === null ? false : isCodexCliPreset(luna)).toBe(true);
});

BunTest.test('legacy OpenAI Luna presets migrate to Codex CLI without API credentials', () => {
  const migrated = decodeSecretBlobValue({
    defaultPreset: 'luna',
    presets: {
      luna: {
        apiKey: 'test-only',
        baseUrl: 'https://api.openai.com',
        contextWindow: 1_050_000,
        model: 'gpt-5.6-luna',
        provider: 'openai',
        reasoningEffort: 'medium',
        serviceTier: 'fast',
      },
    },
  });

  BunTest.expect(migrated?.presets['luna']).toEqual(codexLunaPreset);
});
BunTest.test('previous Codex Luna medium presets migrate to low reasoning', () => {
  const migrated = decodeSecretBlobValue({
    defaultPreset: 'luna',
    presets: {
      luna: {
        contextWindow: 272_000,
        model: 'gpt-5.6-luna',
        provider: 'codex-cli',
        reasoningEffort: 'medium',
        serviceTier: 'fast',
      },
    },
  });
  BunTest.expect(migrated).toEqual({ defaultPreset: 'luna', presets: { luna: codexLunaPreset } });
});

BunTest.test('preset schema rejects invalid context windows before persistence', () => {
  for (const contextWindow of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1, 1.5, null]) {
    BunTest.expect(
      decodeSecretBlobValue({ presets: { invalid: { ...customApiPreset, contextWindow } } }),
    ).toBeNull();
    BunTest.expect(decodePresetValue({ ...customApiPreset, contextWindow })).toBeNull();
  }
});

BunTest.test('preset names reject blanks and prototype keys and lookup only own properties', () => {
  BunTest.expect(validatePresetName('   ')).toBeDefined();
  BunTest.expect(validatePresetName('__proto__')).toBeDefined();
  BunTest.expect(validatePresetName('prototype')).toBeDefined();
  BunTest.expect(validatePresetName('constructor')).toBeDefined();
  BunTest.expect(validatePresetName('openai')).toBeUndefined();
  BunTest.expect(hasOwnPreset({}, 'toString')).toBe(false);
  BunTest.expect(hasOwnPreset({ local: customApiPreset }, 'local')).toBe(true);
});
