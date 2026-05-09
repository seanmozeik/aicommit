import { Schema } from 'effect';

export class CodexCliError extends Schema.TaggedErrorClass<CodexCliError>()('CodexCliError', {
  exitCode: Schema.Number,
  message: Schema.String,
}) {}
