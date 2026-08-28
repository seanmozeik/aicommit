import * as BunTest from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Effect } from 'effect';

import { detectProject, updateProjectVersion } from '../src/release/project';

let dir: string;
let originalCwd: string;

BunTest.beforeEach(() => {
  originalCwd = process.cwd();
  dir = mkdtempSync(path.join(tmpdir(), 'aic-rust-'));
  process.chdir(dir);
});

BunTest.afterEach(() => {
  process.chdir(originalCwd);
  rmSync(dir, { force: true, recursive: true });
});

const writeCargo = (content: string): void => {
  writeFileSync(path.join(dir, 'Cargo.toml'), content);
};

BunTest.test(
  'detects version from [workspace.package] (inherited-version workspaces)',
  async () => {
    writeCargo(`[workspace]
members = ["crates/*"]

[workspace.package]
name = "myworkspace"
version = "1.2.3"
edition = "2021"
`);
    const info = await Effect.runPromise(detectProject());
    BunTest.expect(info?.type).toBe('rust');
    BunTest.expect(info?.version).toBe('1.2.3');
    BunTest.expect(info?.name).toBe('myworkspace');
  },
);

BunTest.test('still detects the classic top-level [package]', async () => {
  writeCargo(`[package]
name = "solo-crate"
version = "0.4.2"
edition = "2021"
`);
  const info = await Effect.runPromise(detectProject());
  BunTest.expect(info?.type).toBe('rust');
  BunTest.expect(info?.version).toBe('0.4.2');
  BunTest.expect(info?.name).toBe('solo-crate');
});

BunTest.test('bumps the version inside [workspace.package]', async () => {
  writeCargo(`[workspace]
members = ["crates/*"]

[workspace.package]
version = "1.2.3"
`);
  const info = await Effect.runPromise(detectProject());
  if (info === null) {
    throw new Error('expected rust project to be detected');
  }
  await Effect.runPromise(updateProjectVersion(info, '1.3.0'));
  const updated = readFileSync(path.join(dir, 'Cargo.toml'), 'utf8');
  BunTest.expect(updated).toContain('version = "1.3.0"');
  BunTest.expect(updated).not.toContain('version = "1.2.3"');
});
