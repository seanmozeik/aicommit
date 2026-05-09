#!/usr/bin/env bun
/**
 * 1) Bundle `src/cli.ts` → minified `dist/aic.js` (see package.json `bin.aic`).
 * 2) Pack `artifacts/aic-{version}.tar.gz` for GitHub/Homebrew (dist/, src/, package.json).
 * 3) SHA256 that tarball and patch `Formula/aic.rb` (`version` + `sha256`).
 *
 * Fast iteration (JS only, no tarball / formula):
 *   bun run build -- --no-formula
 */
import { chmodSync, copyFileSync, cpSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import pkg from '../package.json' with { type: 'json' };

const root = fileURLToPath(new URL('..', import.meta.url));
const skipTarballAndFormula = process.argv.includes('--no-formula');
const { version } = pkg;
const distPrefix = './dist/';
const distDir = join(root, 'dist');
const entry = './src/cli.ts';

const binField = pkg.bin;
if (typeof binField !== 'object' || binField === null || Array.isArray(binField)) {
  throw new TypeError('package.json "bin" must be a map of command names to paths');
}
const binPath = binField['aic'];
if (typeof binPath !== 'string') {
  throw new TypeError('package.json must define bin.aic as a string');
}
if (!binPath.startsWith(distPrefix)) {
  throw new TypeError(`package.json bin.aic must start with "${distPrefix}", got "${binPath}"`);
}
const CLI_BUNDLE_NAME = binPath.slice(distPrefix.length);

rmSync(distDir, { force: true, recursive: true });
mkdirSync(distDir, { recursive: true });

const cli = Bun.spawnSync(
  ['bun', 'build', entry, '--target', 'bun', '--outdir', 'dist', '--minify'],
  { cwd: root, stderr: 'inherit', stdout: 'inherit' },
);
if (cli.exitCode !== 0) {
  process.exit(cli.exitCode ?? 1);
}

const outPath = join(distDir, CLI_BUNDLE_NAME);
renameSync(join(distDir, 'cli.js'), outPath);
chmodSync(outPath, 0o755);

if (skipTarballAndFormula) {
  process.exit(0);
}

/** Homebrew expects `libexec/dist/aic.js` → archive has `dist/<bundle>` at root. */
const archiveInner = `aic-${version}`;
const stageRoot = join(root, 'artifacts', '.stage');
const stageInner = join(stageRoot, archiveInner);

rmSync(stageRoot, { force: true, recursive: true });
mkdirSync(join(stageInner, 'dist'), { recursive: true });
// Copy the built binary
copyFileSync(outPath, join(stageInner, 'dist', CLI_BUNDLE_NAME));
// Copy source for inspection
cpSync(join(root, 'src'), join(stageInner, 'src'), { recursive: true });
copyFileSync(join(root, 'package.json'), join(stageInner, 'package.json'));

mkdirSync(join(root, 'artifacts'), { recursive: true });
const tarName = `aic-${version}.tar.gz`;
const tarPath = join(root, 'artifacts', tarName);

const tar = Bun.spawnSync(['tar', '-czf', tarPath, '-C', stageRoot, archiveInner], {
  cwd: root,
  stderr: 'inherit',
  stdout: 'inherit',
});
if (tar.exitCode !== 0) {
  process.exit(tar.exitCode ?? 1);
}

rmSync(stageRoot, { force: true, recursive: true });

const sha256 = new Bun.CryptoHasher('sha256')
  .update(await Bun.file(tarPath).arrayBuffer())
  .digest('hex');

const formulaPath = join(root, 'Formula', 'aic.rb');
let rb = await Bun.file(formulaPath).text();
rb = rb.replace(/^(\s*version\s+")[^"]+(")/mu, `$1${version}$2`);
rb = rb.replace(/^(\s*sha256\s+")[0-9a-fA-F]+(")/mu, `$1${sha256}$2`);
await Bun.write(formulaPath, rb);

console.log(`Wrote ${tarPath}`);
console.log(`sha256 ${sha256}`);
console.log(`Updated Formula/aic.rb → version ${version}`);
