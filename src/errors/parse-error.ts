import { Schema } from 'effect';

/**
 * Raised when the model output cannot be parsed into the expected schema.
 * This indicates the model returned malformed or unexpected data.
 */
export class ParseError extends Schema.TaggedErrorClass<ParseError>()('ParseError', {
  message: Schema.String,
  rawOutput: Schema.String,
}) {}
