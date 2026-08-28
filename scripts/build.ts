#!/usr/bin/env bun
/**
 * 1) Bundle `src/cli.ts` → minified `dist/aic.js` (see package.json `bin.aic`).
 * 2) Pack `artifacts/aic-{version}.tar.gz` for GitHub/Homebrew (dist/, src/, package.json).
 * 3) SHA256 that tarball and patch `Formula/aic.rb` (`version` + `sha256`).
 *
 * Build the distributable archive without rewriting the checked-in formula:
 *   bun run build -- --no-formula
 */
import { chmodSync, copyFileSync, cpSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import pkg from '../package.json' with { type: 'json' };

const root = fileURLToPath(new URL('..', import.meta.url));
const skipFormulaUpdate = process.argv.includes('--no-formula');
const { version } = pkg;
const distPrefix = './dist/';
const distDir = path.join(root, 'dist');
const entry = './src/cli.ts';

const binField: unknown = pkg.bin;
if (typeof binField !== 'object' || binField === null || Array.isArray(binField)) {
  throw new TypeError('package.json "bin" must be a map of command names to paths');
}
if (!('aic' in binField)) {
  throw new TypeError('package.json must define bin.aic as a string');
}
const binPath = binField.aic;
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
  process.exit(cli.exitCode);
}

const outPath = path.join(distDir, CLI_BUNDLE_NAME);
renameSync(path.join(distDir, 'cli.js'), outPath);
chmodSync(outPath, 0o755);

/** Homebrew expects `libexec/dist/aic.js` → archive has `dist/<bundle>` at root. */
const archiveInner = `aic-${version}`;
const stageRoot = path.join(root, 'artifacts', '.stage');
const stageInner = path.join(stageRoot, archiveInner);

rmSync(stageRoot, { force: true, recursive: true });
mkdirSync(path.join(stageInner, 'dist'), { recursive: true });
copyFileSync(outPath, path.join(stageInner, 'dist', CLI_BUNDLE_NAME));
cpSync(path.join(root, 'src'), path.join(stageInner, 'src'), { recursive: true });
copyFileSync(path.join(root, 'package.json'), path.join(stageInner, 'package.json'));

mkdirSync(path.join(root, 'artifacts'), { recursive: true });
const tarName = `aic-${version}.tar.gz`;
const tarPath = path.join(root, 'artifacts', tarName);

const tar = Bun.spawnSync(['tar', '-czf', tarPath, '-C', stageRoot, archiveInner], {
  cwd: root,
  stderr: 'inherit',
  stdout: 'inherit',
});
if (tar.exitCode !== 0) {
  process.exit(tar.exitCode);
}

const archiveListing = Bun.spawnSync(['tar', '-tzf', tarPath], {
  cwd: root,
  stderr: 'inherit',
  stdout: 'pipe',
});
if (archiveListing.exitCode !== 0) {
  process.exit(archiveListing.exitCode);
}
const archiveEntry = `${archiveInner}/dist/${CLI_BUNDLE_NAME}`;
const archiveFiles = new TextDecoder().decode(archiveListing.stdout).trim().split('\n');
if (!archiveFiles.includes(archiveEntry)) {
  throw new TypeError(`Archive is missing the Homebrew executable entry: ${archiveEntry}`);
}

rmSync(stageRoot, { force: true, recursive: true });

const sha256 = new Bun.CryptoHasher('sha256')
  .update(await Bun.file(tarPath).arrayBuffer())
  .digest('hex');

const formulaPath = path.join(root, 'Formula', 'aic.rb');
let rb = await Bun.file(formulaPath).text();
const formulaExecutable = `#{libexec}/dist/${CLI_BUNDLE_NAME}`;
if (!rb.includes(formulaExecutable)) {
  throw new TypeError(`Formula wrapper must execute ${formulaExecutable}`);
}

if (skipFormulaUpdate) {
  process.stdout.write(`Wrote ${tarPath}\nVerified ${archiveEntry}\n`);
  process.exit(0);
}

rb = rb.replace(/^(?<prefix>\s*version\s+")[^"]+(?<suffix>")/mu, `$<prefix>${version}$<suffix>`);
rb = rb.replace(
  /^(?<prefix>\s*sha256\s+")[0-9a-fA-F]+(?<suffix>")/mu,
  `$<prefix>${sha256}$<suffix>`,
);
await Bun.write(formulaPath, rb);

process.stdout.write(
  `Wrote ${tarPath}\nsha256 ${sha256}\nUpdated Formula/aic.rb → version ${version}\n`,
);
