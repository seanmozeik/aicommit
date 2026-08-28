import * as BunTest from 'bun:test';

import { Effect } from 'effect';

import {
  makeLunaPreset,
  parseContextWindow,
  persistConfiguredPreset,
  resolvePromptValue,
  validateContextWindow,
  validateCustomBaseUrl,
} from '../src/commands/setup';

BunTest.test('setup URL policy permits HTTPS and loopback HTTP only', () => {
  BunTest.expect(validateCustomBaseUrl('https://example.com/v1')).toBeUndefined();
  BunTest.expect(validateCustomBaseUrl('http://localhost:1234/v1')).toBeUndefined();
  BunTest.expect(validateCustomBaseUrl('http://127.0.0.2:1234/v1')).toBeUndefined();
  BunTest.expect(validateCustomBaseUrl('http://[::1]:1234/v1')).toBeUndefined();
  BunTest.expect(validateCustomBaseUrl('http://example.com/v1')).toContain('loopback');
  BunTest.expect(validateCustomBaseUrl('ftp://example.com')).toContain('http');
});

BunTest.test('setup validates positive integral context windows', () => {
  for (const value of ['NaN', 'Infinity', '0', '-1', '1.5']) {
    BunTest.expect(validateContextWindow(value)).toBeDefined();
    BunTest.expect(() => parseContextWindow(value)).toThrow();
  }
  BunTest.expect(parseContextWindow('1050000')).toBe(1_050_000);
});

BunTest.test('first-class Luna setup fixes the Codex CLI controls', () => {
  BunTest.expect(makeLunaPreset()).toEqual({
    contextWindow: 272_000,
    model: 'gpt-5.6-luna',
    provider: 'codex-cli',
    reasoningEffort: 'medium',
    serviceTier: 'fast',
  });
});

BunTest.test('setup cancellation stops before any credential persistence', async () => {
  let writes = 0;
  const preset = makeLunaPreset();
  const program = resolvePromptValue(
    Symbol('cancel'),
    (candidate): candidate is symbol => typeof candidate === 'symbol',
  ).pipe(
    Effect.andThen(
      persistConfiguredPreset('luna', preset, true, {
        saveDefault: () => {
          writes += 1;
          return Promise.resolve('memory');
        },
        savePreset: () => {
          writes += 1;
          return Promise.resolve('memory');
        },
      }),
    ),
    Effect.exit,
  );

  const exit = await Effect.runPromise(program);
  BunTest.expect(exit._tag).toBe('Failure');
  BunTest.expect(writes).toBe(0);
});
