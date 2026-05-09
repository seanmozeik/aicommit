#!/usr/bin/env bun
import { BunServices } from '@effect/platform-bun';
import { Effect, Layer, Logger, type LogLevel } from 'effect';
import { Command } from 'effect/unstable/cli';

import pkg from '../package.json' with { type: 'json' };
import { commitCommand } from './cli-commit.js';
import { presetFlag, skillFlag } from './cli-flags.js';
import { setupCommand } from './cli-setup.js';
import { teardownCommand } from './cli-teardown.js';

const app = Command.make('aic', { preset: presetFlag, skill: skillFlag }, ({ skill }) =>
  Effect.sync(() => {
    if (skill) {
      console.log('AI Commit Message Generator - Preset-based CLI');
      console.log('');
      console.log('Commands:');
      console.log('  (default)  Generate a commit message from staged/unstaged changes');
      console.log('  setup      Configure AI presets');
      console.log('  teardown   Remove stored presets');
      console.log('');
      console.log('Options:');
      console.log('  --preset <name>  AI preset name');
      console.log('  --skill           Show this help');
    }
  }),
).pipe(Command.withSubcommands([commitCommand, setupCommand, teardownCommand]));

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

const verbose = process.argv.includes('--verbose') || process.argv.includes('-v');
const _minLogLevel: LogLevel.LogLevel = verbose ? 'Debug' : 'Warn';

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
