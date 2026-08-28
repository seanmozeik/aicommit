import type { Preset } from '../config/secrets';

const DEFAULT_CONTEXT_WINDOW = 32_000;
const DEFAULT_OUTPUT_CONTEXT_FRACTION = 0.05;
const MIN_OUTPUT_TOKENS = 64;
const INPUT_SAFETY_MARGIN_TOKENS = 1024;

interface ModelBudgets {
  readonly contextWindow: number;
  readonly inputSafetyMarginTokens: number;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
}

const finiteNonNegativeInteger = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;

const getModelBudgets = (
  preset: Preset | null,
  options: { readonly outputContextFraction?: number } = {},
): ModelBudgets => {
  const contextWindow = finiteNonNegativeInteger(preset?.contextWindow ?? DEFAULT_CONTEXT_WINDOW);
  const outputFraction = Number.isFinite(options.outputContextFraction)
    ? Math.max(0, options.outputContextFraction ?? DEFAULT_OUTPUT_CONTEXT_FRACTION)
    : DEFAULT_OUTPUT_CONTEXT_FRACTION;
  const maxOutputTokens = Math.max(MIN_OUTPUT_TOKENS, Math.floor(contextWindow * outputFraction));
  const inputSafetyMarginTokens = Math.min(INPUT_SAFETY_MARGIN_TOKENS, contextWindow);
  const maxInputTokens = finiteNonNegativeInteger(
    contextWindow - maxOutputTokens - inputSafetyMarginTokens,
  );

  return { contextWindow, inputSafetyMarginTokens, maxInputTokens, maxOutputTokens };
};

export { getModelBudgets };
export type { ModelBudgets };
