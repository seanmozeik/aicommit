import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';

import { detectProject, updateProjectVersion } from '../src/project';

let dir: string;
let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
  dir = mkdtempSync(join(tmpdir(), 'aic-rust-'));
  process.chdir(dir);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(dir, { force: true, recursive: true });
});

const writeCargo = (content: string): void => {
  writeFileSync(join(dir, 'Cargo.toml'), content);
};

test('detects version from [workspace.package] (inherited-version workspaces)', async () => {
  writeCargo(`[workspace]
members = ["crates/*"]

[workspace.package]
name = "myworkspace"
version = "1.2.3"
edition = "2021"
`);
  const info = await Effect.runPromise(detectProject());
  expect(info?.type).toBe('rust');
  expect(info?.version).toBe('1.2.3');
  expect(info?.name).toBe('myworkspace');
});

test('still detects the classic top-level [package]', async () => {
  writeCargo(`[package]
name = "solo-crate"
version = "0.4.2"
edition = "2021"
`);
  const info = await Effect.runPromise(detectProject());
  expect(info?.type).toBe('rust');
  expect(info?.version).toBe('0.4.2');
  expect(info?.name).toBe('solo-crate');
});

test('bumps the version inside [workspace.package]', async () => {
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
  const updated = readFileSync(join(dir, 'Cargo.toml'), 'utf8');
  expect(updated).toContain('version = "1.3.0"');
  expect(updated).not.toContain('version = "1.2.3"');
});
