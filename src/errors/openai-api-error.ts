import { Schema } from 'effect';

export class OpenAiApiError extends Schema.TaggedErrorClass<OpenAiApiError>()('OpenAiApiError', {
  error: Schema.Defect,
  message: Schema.String,
  statusCode: Schema.Number,
}) {}
