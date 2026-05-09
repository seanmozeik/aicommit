import { countTokens } from 'gpt-tokenizer/encoding/o200k_base';

const estimateTokens = (text: string): number => countTokens(text);

export { estimateTokens };
