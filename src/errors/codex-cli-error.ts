import { Schema } from 'effect';

export class CodexCliError extends Schema.TaggedError<CodexCliError>()('CodexCliError', {
  exitCode: Schema.Finite,
  message: Schema.String,
}) {}
