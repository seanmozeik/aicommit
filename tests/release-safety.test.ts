import * as BunTest from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Effect } from 'effect';

import { requireCleanRepository, resolveReleasePromptValue } from '../src/commands/release';

const runGit = async (directory: string, ...args: readonly string[]): Promise<void> => {
  const process = Bun.spawn(['git', '-C', directory, ...args], { stderr: 'pipe', stdout: 'pipe' });
  const exitCode = await process.exited;
  if (exitCode !== 0) {
    throw new Error(await new Response(process.stderr).text());
  }
};

const makeRepository = async (): Promise<string> => {
  const directory = mkdtempSync(path.join(tmpdir(), 'aic-release-'));
  await runGit(directory, 'init');
  await runGit(directory, 'config', 'user.email', 'test@example.com');
  await runGit(directory, 'config', 'user.name', 'Test User');
  writeFileSync(path.join(directory, 'tracked.txt'), 'initial\n');
  await runGit(directory, 'add', 'tracked.txt');
  await runGit(directory, 'commit', '-m', 'initial');
  return directory;
};

const expectDirtyPreflight = async (
  change: (directory: string) => Promise<void>,
): Promise<void> => {
  const directory = await makeRepository();
  const previousCwd = process.cwd();
  try {
    await change(directory);
    process.chdir(directory);
    const failure = await Effect.runPromise(requireCleanRepository().pipe(Effect.flip));
    BunTest.expect(failure.message).toContain('clean repository');
  } finally {
    process.chdir(previousCwd);
    rmSync(directory, { force: true, recursive: true });
  }
};

BunTest.test('release preflight rejects staged, unstaged, and untracked changes', async () => {
  await expectDirtyPreflight(async (directory) => {
    writeFileSync(path.join(directory, 'staged.txt'), 'staged\n');
    await runGit(directory, 'add', 'staged.txt');
  });
  await expectDirtyPreflight((directory) => {
    writeFileSync(path.join(directory, 'tracked.txt'), 'changed\n');
    return Promise.resolve();
  });
  await expectDirtyPreflight((directory) => {
    writeFileSync(path.join(directory, 'untracked.txt'), 'untracked\n');
    return Promise.resolve();
  });
});

BunTest.test('release cancellation cannot fall through as consent', async () => {
  let mutations = 0;
  const program = resolveReleasePromptValue(
    Symbol('cancel'),
    (candidate): candidate is symbol => typeof candidate === 'symbol',
  ).pipe(
    Effect.andThen(
      Effect.sync(() => {
        mutations += 1;
      }),
    ),
    Effect.exit,
  );

  const exit = await Effect.runPromise(program);
  BunTest.expect(exit._tag).toBe('Failure');
  BunTest.expect(mutations).toBe(0);
});
