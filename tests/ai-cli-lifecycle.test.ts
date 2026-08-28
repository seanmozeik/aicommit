import * as BunTest from 'bun:test';
import { mkdtemp, mkdir, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Effect, Fiber } from 'effect';

import { generateWithClaude } from '../src/ai';
import { buildCodexArgs, generateWithCodex } from '../src/ai/codex';
import { makeLunaPreset } from '../src/commands/setup';

let testDirectory = '';
let childScript = '';
let codexTempDirectory = '';

const childSource = `
const mode = process.argv[2];
const value = process.argv[3];
if (mode === 'success') {
  process.stdout.write('fix: child completed');
} else if (mode === 'failure') {
  process.stderr.write('deterministic child failure');
  process.exit(7);
} else if (mode === 'codex-success') {
  await Bun.write(value, JSON.stringify({ message: 'fix: codex completed' }));
} else if (mode === 'hang') {
  await Bun.write(value, String(process.pid));
  await new Promise(() => {});
}
`;

const waitForPid = async (filePath: string): Promise<number> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const file = Bun.file(filePath);
    if (await file.exists()) {
      return Number(await file.text());
    }
    await Bun.sleep(5);
  }
  throw new Error(`Child did not write PID file: ${filePath}`);
};

const expectProcessStopped = (pid: number): void => {
  BunTest.expect(() => process.kill(pid, 0)).toThrow();
};

const captureFailure = async (operation: Promise<unknown>): Promise<unknown> => {
  try {
    await operation;
  } catch (error) {
    return error;
  }
  throw new Error('Expected operation to fail');
};

BunTest.beforeEach(async () => {
  testDirectory = await mkdtemp(path.join(tmpdir(), 'aicommit-lifecycle-test-'));
  childScript = path.join(testDirectory, 'child.ts');
  codexTempDirectory = path.join(testDirectory, 'codex-temp');
  await mkdir(codexTempDirectory);
  await Bun.write(childScript, childSource);
});

BunTest.afterEach(async () => {
  await rm(testDirectory, { force: true, recursive: true });
});

BunTest.test('Luna uses Codex CLI low reasoning and fast mode', () => {
  const { model, reasoningEffort, serviceTier } = makeLunaPreset();
  BunTest.expect(
    buildCodexArgs('schema.json', 'output.json', { model, reasoningEffort, serviceTier }),
  ).toEqual([
    '--ask-for-approval',
    'never',
    '--enable',
    'fast_mode',
    'exec',
    '--model',
    'gpt-5.6-luna',
    '--config',
    'model_reasoning_effort="low"',
    '--config',
    'service_tier="fast"',
    '--sandbox',
    'read-only',
    '--ephemeral',
    '--ignore-rules',
    '--color',
    'never',
    '--output-schema',
    'schema.json',
    '--output-last-message',
    'output.json',
    '-',
  ]);
});

BunTest.describe('AI CLI lifecycle', () => {
  BunTest.test('Claude preserves normal stdout and non-zero status behavior', async () => {
    const message = await Effect.runPromise(
      generateWithClaude('ignored', { command: [process.execPath, childScript, 'success'] }),
    );
    BunTest.expect(message).toBe('fix: child completed');

    const failure = await captureFailure(
      Effect.runPromise(
        generateWithClaude('ignored', { command: [process.execPath, childScript, 'failure'] }),
      ),
    );
    BunTest.expect(String(failure)).toContain('deterministic child failure');
  });

  BunTest.test('Claude terminates and observes its child on timeout', async () => {
    const pidPath = path.join(testDirectory, 'claude-timeout.pid');
    const result = Effect.runPromise(
      generateWithClaude('ignored', {
        command: [process.execPath, childScript, 'hang', pidPath],
        timeoutMs: 100,
      }),
    );
    const pid = await waitForPid(pidPath);

    const failure = await captureFailure(result);
    BunTest.expect(String(failure)).toContain('Claude CLI generation timed out');
    expectProcessStopped(pid);
  });

  BunTest.test('Codex terminates its child and removes temp files when interrupted', async () => {
    const pidPath = path.join(testDirectory, 'codex-interrupt.pid');
    const fiber = Effect.runFork(
      generateWithCodex('ignored', {
        command: () => [process.execPath, childScript, 'hang', pidPath],
        tempDirectory: codexTempDirectory,
      }),
    );
    const pid = await waitForPid(pidPath);

    await Effect.runPromise(Fiber.interrupt(fiber));

    expectProcessStopped(pid);
    BunTest.expect(await readdir(codexTempDirectory)).toEqual([]);
  });

  BunTest.test('Codex removes temp files after success and provider failure', async () => {
    const message = await Effect.runPromise(
      generateWithCodex('ignored', {
        command: (_schemaPath, outputPath) => [
          process.execPath,
          childScript,
          'codex-success',
          outputPath,
        ],
        tempDirectory: codexTempDirectory,
      }),
    );
    BunTest.expect(message).toBe('fix: codex completed');
    BunTest.expect(await readdir(codexTempDirectory)).toEqual([]);

    const failure = await captureFailure(
      Effect.runPromise(
        generateWithCodex('ignored', {
          command: () => [process.execPath, childScript, 'failure'],
          tempDirectory: codexTempDirectory,
        }),
      ),
    );
    BunTest.expect(String(failure)).toContain('deterministic child failure');
    BunTest.expect(await readdir(codexTempDirectory)).toEqual([]);
  });
});
