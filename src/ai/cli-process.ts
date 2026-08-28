import { Effect, type Scope } from 'effect';

const CLI_GENERATION_TIMEOUT_MS = 120_000;

type PipedSubprocess = Bun.Subprocess<'pipe', 'pipe', 'pipe'>;

const terminateProcess = (proc: PipedSubprocess): Effect.Effect<void> =>
  Effect.promise(async () => {
    if (proc.exitCode === null) {
      proc.kill();
    }
    try {
      await proc.exited;
    } catch {
      // The provider-facing operation already carries the primary failure.
    }
  });

const acquireProcess = <E>(
  command: readonly string[],
  onSpawnError: (error: unknown) => E,
): Effect.Effect<PipedSubprocess, E, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.try({
      catch: onSpawnError,
      try: () => Bun.spawn([...command], { stderr: 'pipe', stdin: 'pipe', stdout: 'pipe' }),
    }),
    terminateProcess,
  );

export { acquireProcess, CLI_GENERATION_TIMEOUT_MS };
export type { PipedSubprocess };
