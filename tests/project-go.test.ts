import * as BunTest from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Effect } from 'effect';

import { detectProject } from '../src/release/project';

let directory: string;
let previousCwd: string;

BunTest.beforeEach(() => {
  previousCwd = process.cwd();
  directory = mkdtempSync(path.join(tmpdir(), 'aic-go-'));
  process.chdir(directory);
});

BunTest.afterEach(() => {
  process.chdir(previousCwd);
  rmSync(directory, { force: true, recursive: true });
});

const write = (filename: string, content: string): void => {
  writeFileSync(path.join(directory, filename), content);
};

BunTest.test('Go detection uses version.go when ordinary go.mod has no version', async () => {
  write('go.mod', 'module example.com/tools/demo\n\ngo 1.24\n');
  write('version.go', 'package demo\n\nconst Version = "1.2.3"\n');

  const project = await Effect.runPromise(detectProject());
  BunTest.expect(project).toEqual({
    metadataFiles: ['version.go'],
    name: 'demo',
    type: 'go',
    version: '1.2.3',
  });
});

BunTest.test('Go detection falls back only after version.go is missing or malformed', async () => {
  write('go.mod', 'module example.com/tools/demo\n\ngo 1.24\n');
  const missing = await Effect.runPromise(detectProject());
  BunTest.expect(missing?.version).toBe('0.0.0');

  write('version.go', 'package demo\n\nconst Version = unavailable\n');
  const malformed = await Effect.runPromise(detectProject());
  BunTest.expect(malformed?.version).toBe('0.0.0');
});

BunTest.test('Go detection preserves explicit usable version metadata in go.mod', async () => {
  write(
    'go.mod',
    'module example.com/tools/demo\n\ngo 1.24\n\n// generated metadata\nVersion = "2.3.4"\n',
  );

  const project = await Effect.runPromise(detectProject());
  BunTest.expect(project?.version).toBe('2.3.4');
  BunTest.expect(project?.metadataFiles).toEqual(['go.mod']);
});
