#!/usr/bin/env bun
import { BunServices } from '@effect/platform-bun';
import { Effect, Layer, Logger } from 'effect';
import { Command } from 'effect/unstable/cli';

import pkg from '../package.json' with { type: 'json' };
import { commitCommand, commitHandler } from './cli-commit';
import { presetFlag, skillFlag } from './cli-flags';
import { releaseCommand, releaseInitCommand } from './cli-release';
import { setupCommand } from './cli-setup';
import { teardownCommand } from './cli-teardown';

const app = Command.make('aic', { preset: presetFlag, skill: skillFlag }, ({ preset, skill }) =>
  Effect.gen(function* appHandler() {
    if (skill) {
      console.log('AI Commit Message Generator - Preset-based CLI');
      console.log('');
      console.log('Commands:');
      console.log('  (default)      Generate a commit message from staged/unstaged changes');
      console.log('  commit         Generate a commit message (explicit)');
      console.log('  release        Create a release with version bump, changelog, and tag');
      console.log('  release-init   Initialize release configuration for the project');
      console.log('  setup          Configure AI presets');
      console.log('  teardown       Remove stored presets');
      console.log('');
      console.log('Options:');
      console.log('  --preset <name>  AI preset name');
      console.log('  --skill           Show this help');
    } else {
      yield* commitHandler(preset);
    }
  }),
).pipe(
  Command.withSubcommands([
    commitCommand,
    releaseCommand,
    releaseInitCommand,
    setupCommand,
    teardownCommand,
  ]),
);

const program = Command.run(app, { version: pkg.version });

const stderrLogger = Logger.make(({ logLevel, message }) => {
  let text: string;
  if (Array.isArray(message)) {
    text = message.map((m) => (typeof m === 'string' ? m : JSON.stringify(m))).join(' ');
  } else if (typeof message === 'string') {
    text = message;
  } else {
    text = JSON.stringify(message);
  }
  process.stderr.write(`[${logLevel.toLowerCase()}] ${text}\n`);
});

const runtimeLayer = Layer.mergeAll(BunServices.layer, Logger.layer([stderrLogger]));

const writeBoundaryError = (error: unknown): void => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
};

try {
  await Effect.runPromise(program.pipe(Effect.provide(runtimeLayer)));
} catch (error) {
  writeBoundaryError(error);
}
