import { BunServices } from '@effect/platform-bun';
import { Effect, Layer, Logger } from 'effect';
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

const runCli = async (): Promise<void> => {
  const program = Command.run(app, { version: pkg.version });
  try {
    await Effect.runPromise(program.pipe(Effect.provide(runtimeLayer)));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
};

export { runCli };
