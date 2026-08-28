#!/usr/bin/env bun

import pkg from '../package.json' with { type: 'json' };

const SKILL_TEXT = `AI Commit Message Generator - Preset-based CLI

Commands:
  (default)      Generate a commit message from staged/unstaged changes
  commit         Generate a commit message (explicit)
  release        Create a release with version bump, changelog, and tag
  release-init   Initialize release configuration for the project
  setup          Configure AI presets
  teardown       Remove stored presets

Options:
  --preset <name>  AI preset name
  --skill           Show this help
`;

const HELP_TEXT = `aic ${pkg.version}

AI-powered conventional commit message generator

Usage: aic [--preset <name>] [command]

Commands:
  commit         Generate a commit message
  release        Create a release
  release-init   Initialize release configuration
  setup          Configure AI presets
  teardown       Remove stored presets

Options:
  --preset <name>  AI preset name
  --skill           Show agent-facing command documentation
  --help, -h        Show this help
  --version, -v     Show the version
`;

const args = Bun.argv.slice(2);
const [fastPath] = args;

if (fastPath === '--skill') {
  process.stdout.write(SKILL_TEXT);
} else if (fastPath === '--help' || fastPath === '-h') {
  process.stdout.write(HELP_TEXT);
} else if (fastPath === '--version' || fastPath === '-v') {
  process.stdout.write(`${pkg.version}\n`);
} else {
  const { runCli } = await import('./commands/run');
  await runCli();
}
