import * as BunTest from 'bun:test';

import { Effect } from 'effect';

import { applyTeardownSelection, resolveTeardownPromptValue } from '../src/commands/teardown';

interface DeletionCounts {
  all: number;
  names: string[];
}

const persistence = (counts: DeletionCounts) => ({
  deleteAll: () => {
    counts.all += 1;
    return Promise.resolve(true);
  },
  deleteOne: (name: string) => {
    counts.names.push(name);
    return Promise.resolve();
  },
});

BunTest.test('teardown cancellation and negative confirmation preserve credentials', async () => {
  const counts: DeletionCounts = { all: 0, names: [] };
  const cancelled = resolveTeardownPromptValue(
    Symbol('cancel'),
    (candidate): candidate is symbol => typeof candidate === 'symbol',
  ).pipe(Effect.andThen(applyTeardownSelection('all', true, persistence(counts))), Effect.exit);
  const exit = await Effect.runPromise(cancelled);
  const deleted = await Effect.runPromise(
    applyTeardownSelection('openai', false, persistence(counts)),
  );

  BunTest.expect(exit._tag).toBe('Failure');
  BunTest.expect(deleted).toBe(false);
  BunTest.expect(counts).toEqual({ all: 0, names: [] });
});

BunTest.test('teardown explicit confirmation deletes one preset or all presets', async () => {
  const counts: DeletionCounts = { all: 0, names: [] };
  const oneDeleted = await Effect.runPromise(
    applyTeardownSelection('openai', true, persistence(counts)),
  );
  const allDeleted = await Effect.runPromise(
    applyTeardownSelection('all', true, persistence(counts)),
  );

  BunTest.expect(oneDeleted).toBe(true);
  BunTest.expect(allDeleted).toBe(true);
  BunTest.expect(counts).toEqual({ all: 1, names: ['openai'] });
});
