import { Schema } from 'effect';

export class ApiResponseError extends Schema.TaggedError<ApiResponseError>()('ApiResponseError', {
  message: Schema.String,
}) {}
