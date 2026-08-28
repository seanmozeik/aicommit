import * as BunTest from 'bun:test';

import { Cause } from 'effect';

import { renderCliError } from '../src/commands/run';

BunTest.test('CLI errors expose nested Effect UnknownError causes', () => {
  const wrapped = new Cause.UnknownError(
    new Cause.UnknownError(new Error('Stored preset is invalid')),
  );

  BunTest.expect(renderCliError(wrapped)).toBe('Stored preset is invalid');
});
