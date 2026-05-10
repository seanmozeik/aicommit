import { Schema } from 'effect';

/**
 * Raised when the model fails to call the expected tool and no text fallback is available.
 * This is distinct from general API errors as it indicates a model behavior issue rather
 * than a network or API problem.
 */
export class ToolCallError extends Schema.TaggedErrorClass<ToolCallError>()('ToolCallError', {
  finishReason: Schema.String,
  message: Schema.String,
  toolCallsCount: Schema.Number,
}) {}
