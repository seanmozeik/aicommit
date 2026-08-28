import { Schema } from 'effect';

/**
 * Raised when the operation times out. This is a transient error that may be resolved
 * by retrying with a longer timeout or reducing the complexity of the request.
 */
export class TimeoutError extends Schema.TaggedError<TimeoutError>()('TimeoutError', {
  message: Schema.String,
  timeoutMs: Schema.Finite,
}) {}
