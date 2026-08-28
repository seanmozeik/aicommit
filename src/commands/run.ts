import { BunServices } from '@effect/platform-bun';
import { Cause, Effect, Exit, Layer, Logger } from 'effect';
import { Command } from 'effect/unstable/cli';

import pkg from '../../package.json' with { type: 'json' };
import { commitCommand, commitHandler } from './commit';
import { presetFlag } from './flags';
import { releaseCommand, releaseInitCommand } from './release';
import { setupCommand } from './setup';
import { teardownCommand } from './teardown';

const app = Command.make('aic', { preset: presetFlag }, ({ preset }) => commitHandler(preset)).pipe(
  Command.withSubcommands([
    commitCommand,
    releaseCommand,
    releaseInitCommand,
    setupCommand,
    teardownCommand,
  ]),
);

const runtimeLayer = Layer.mergeAll(BunServices.layer, Logger.layer([]));

const unwrapUnknownErrors = (error: unknown): unknown => {
  const seen = new Set<unknown>();
  let current = error;
  while (Cause.isUnknownError(current) && current.cause !== undefined && !seen.has(current)) {
    seen.add(current);
    current = current.cause;
  }
  return current;
};

export const renderCliError = (error: unknown): string => {
  const unwrapped = unwrapUnknownErrors(error);
  return unwrapped instanceof Error ? unwrapped.message : String(unwrapped);
};

const runCli = async (): Promise<void> => {
  const program = Command.run(app, { version: pkg.version });
  const exit = await Effect.runPromiseExit(program.pipe(Effect.provide(runtimeLayer)));
  if (Exit.isFailure(exit)) {
    process.stderr.write(`${renderCliError(Cause.squash(exit.cause))}\n`);
    process.exitCode = 1;
  }
};

export { runCli };
