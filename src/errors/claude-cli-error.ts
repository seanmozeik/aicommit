import { Schema } from 'effect';

export class ClaudeCliError extends Schema.TaggedErrorClass<ClaudeCliError>()('ClaudeCliError', {
  exitCode: Schema.Number,
  message: Schema.String,
}) {}
