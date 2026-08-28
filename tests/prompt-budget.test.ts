import * as BunTest from 'bun:test';

import { getModelBudgets } from '../src/ai/model-budgets';
import { compressDiffs } from '../src/commit/diff-parser';
import { buildBudgetedCommitPrompt } from '../src/commit/prompt';
import { estimateTokens } from '../src/commit/tokenizer';
import type { FileDiff } from '../src/domain/types';
import { buildBudgetedChangelogPrompt } from '../src/release/changelog';

const repeated = (prefix: string): string =>
  Array.from({ length: 2000 }, (_, index) => `${prefix}-${index}`).join('\n');

BunTest.describe('final AI input budgets', () => {
  BunTest.test('bounds oversized commit context and preserves fixed instructions', () => {
    const budget = 420;
    const result = buildBudgetedCommitPrompt(
      {
        compressedDiffs: repeated('diff'),
        fileList: repeated('file'),
        recentCommits: Array.from({ length: 1000 }, (_, index) => `fix: history ${index}`),
        selectedType: 'fix',
        semantics: {
          classes: [repeated('class')],
          exports: [repeated('export')],
          functions: [repeated('function')],
          types: [repeated('type')],
        },
        stats: repeated('stat'),
        userInput: repeated('note'),
      },
      budget,
    );

    BunTest.expect(result.estimatedInputTokens).toBeLessThanOrEqual(budget);
    BunTest.expect(
      estimateTokens(`${result.systemPrompt}\n\n${result.userPrompt}`),
    ).toBeLessThanOrEqual(budget);
    BunTest.expect(result.systemPrompt).toContain('SubmitCommitMessage');
    BunTest.expect(result.userPrompt).toContain('## Commit Types');
    BunTest.expect(result.userPrompt).toContain('[truncated to fit input budget]');
  });

  BunTest.test('bounds oversized changelog history and preserves release rules', () => {
    const budget = 280;
    const result = buildBudgetedChangelogPrompt(
      '1.2.3',
      Array.from({ length: 2000 }, (_, index) => ({
        hash: String(index),
        message: `feat: historical change ${index}`,
      })),
      repeated('stat'),
      {
        classes: [repeated('class')],
        exports: [repeated('export')],
        functions: [repeated('function')],
        types: [repeated('type')],
      },
      budget,
    );

    BunTest.expect(result.estimatedInputTokens).toBeLessThanOrEqual(budget);
    BunTest.expect(result.userPrompt).toContain('Release: 1.2.3');
    BunTest.expect(result.userPrompt).toContain('Do not include the version heading or date.');
    BunTest.expect(result.userPrompt).toContain('[truncated to fit input budget]');
  });

  BunTest.test('never derives a negative input allocation', () => {
    const budgets = getModelBudgets({
      apiKey: 'test-only',
      baseUrl: 'https://example.test',
      contextWindow: 100,
      model: 'tiny-model',
    });

    BunTest.expect(budgets.maxInputTokens).toBe(0);
    BunTest.expect(budgets.inputSafetyMarginTokens).toBe(100);
  });
});

BunTest.describe('diff token estimation', () => {
  BunTest.test('estimates each retained detailed entry once', () => {
    const file: FileDiff = {
      additions: 1,
      deletions: 0,
      diff: '@@ -0,0 +1 @@\n+const answer = 42;',
      path: 'src/answer.ts',
      status: 'modified',
    };
    const calls = new Map<string, number>();
    const estimator = (text: string): number => {
      calls.set(text, (calls.get(text) ?? 0) + 1);
      return 1;
    };

    const result = compressDiffs([file], { estimator, tokenBudget: 100 });

    BunTest.expect(result).toContain('const answer = 42;');
    BunTest.expect([...calls.values()].every((count) => count === 1)).toBe(true);
  });
});
