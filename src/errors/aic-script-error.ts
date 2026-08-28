import { Schema } from 'effect';

export class AicScriptError extends Schema.TaggedError<AicScriptError>()('AicScriptError', {
  cause: Schema.Defect(),
  message: Schema.String,
}) {}
