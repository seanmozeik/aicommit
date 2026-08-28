import { Flag } from 'effect/unstable/cli';

export const skillFlag = Flag.boolean('skill').pipe(
  Flag.withDescription('Show skill documentation'),
);

export const presetFlag = Flag.string('preset').pipe(
  Flag.optional,
  Flag.withDescription('AI preset name'),
);
