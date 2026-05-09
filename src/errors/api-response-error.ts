import { Schema } from 'effect';

export class ApiResponseError extends Schema.TaggedErrorClass<ApiResponseError>()(
  'ApiResponseError',
  { message: Schema.String },
) {}
