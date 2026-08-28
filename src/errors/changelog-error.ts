import { Schema } from 'effect';

export class ChangelogError extends Schema.TaggedError<ChangelogError>()('ChangelogError', {
  cause: Schema.Defect(),
  message: Schema.String,
}) {}
