import { Schema } from 'effect';

export class OpenAiApiError extends Schema.TaggedError<OpenAiApiError>()('OpenAiApiError', {
  error: Schema.Defect(),
  message: Schema.String,
  responseBody: Schema.optionalKey(Schema.String),
  statusCode: Schema.Finite,
}) {}
