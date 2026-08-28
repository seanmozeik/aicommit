import { Schema } from 'effect';

export class ReleaseError extends Schema.TaggedError<ReleaseError>()('ReleaseError', {
  cause: Schema.optionalKey(Schema.Defect()),
  message: Schema.String,
}) {}
