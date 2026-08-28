import { Schema } from 'effect';

export class SetupError extends Schema.TaggedError<SetupError>()('SetupError', {
  cause: Schema.Defect(),
  message: Schema.String,
}) {}
