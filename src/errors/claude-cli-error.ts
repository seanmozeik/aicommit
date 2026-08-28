import { Schema } from 'effect';

export class ClaudeCliError extends Schema.TaggedError<ClaudeCliError>()('ClaudeCliError', {
  exitCode: Schema.Finite,
  message: Schema.String,
}) {}
