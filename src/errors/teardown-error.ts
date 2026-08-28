import { Schema } from 'effect';

export class TeardownError extends Schema.TaggedError<TeardownError>()('TeardownError', {
  cause: Schema.Defect(),
  message: Schema.String,
}) {}
