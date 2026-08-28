import { estimateTokens } from './tokenizer';
import { COMMIT_TYPES } from './types';

interface Semantics {
  readonly functions: readonly string[];
  readonly types: readonly string[];
  readonly exports: readonly string[];
  readonly classes: readonly string[];
}

interface BuildPromptOptions {
  readonly userInput: string;
  readonly stats: string;
  readonly semantics: Semantics;
  readonly fileList: string;
  readonly compressedDiffs: string;
  readonly selectedType?: string;
  readonly recentCommits?: readonly string[];
}

interface PromptSection {
  readonly content: string;
  readonly title: string;
}

interface BoundedPrompt {
  readonly estimatedInputTokens: number;
  readonly inputBudget: number;
  readonly systemPrompt: string;
  readonly userPrompt: string;
}

interface BuildBoundedPromptOptions {
  readonly fixedPrefix: string;
  readonly fixedSuffix: string;
  readonly inputBudget: number;
  readonly sections: readonly PromptSection[];
  readonly systemPrompt: string;
}

const TRUNCATION_MARKER = '[truncated to fit input budget]';

const promptInputText = (systemPrompt: string, userPrompt: string): string =>
  `${systemPrompt}\n\n${userPrompt}`;

const renderSection = (section: PromptSection, content: string): string =>
  `## ${section.title}\n${content}`;

const buildBoundedPrompt = (
  options: BuildBoundedPromptOptions,
  estimator: (text: string) => number = estimateTokens,
): BoundedPrompt => {
  const inputBudget = Number.isFinite(options.inputBudget)
    ? Math.max(0, Math.floor(options.inputBudget))
    : 0;
  const boundedContents = options.sections.map(() => TRUNCATION_MARKER);
  const render = (): string =>
    [
      options.fixedPrefix,
      ...options.sections.map((section, index) =>
        renderSection(section, boundedContents[index] ?? TRUNCATION_MARKER),
      ),
      options.fixedSuffix,
    ].join('\n\n');

  for (const [index, section] of options.sections.entries()) {
    boundedContents[index] = section.content.trim() || '(none)';
    if (estimator(promptInputText(options.systemPrompt, render())) > inputBudget) {
      let low = 0;
      let high = section.content.length;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        boundedContents[index] =
          `${section.content.slice(0, middle).trimEnd()}\n${TRUNCATION_MARKER}`;
        if (estimator(promptInputText(options.systemPrompt, render())) <= inputBudget) {
          low = middle;
        } else {
          high = middle - 1;
        }
      }
      boundedContents[index] =
        low === 0
          ? TRUNCATION_MARKER
          : `${section.content.slice(0, low).trimEnd()}\n${TRUNCATION_MARKER}`;
    }
  }

  let userPrompt = render();
  let estimatedInputTokens = estimator(promptInputText(options.systemPrompt, userPrompt));
  if (estimatedInputTokens > inputBudget) {
    userPrompt = `${options.fixedPrefix}\n\n${TRUNCATION_MARKER}\n\n${options.fixedSuffix}`;
    estimatedInputTokens = estimator(promptInputText(options.systemPrompt, userPrompt));
  }

  return { estimatedInputTokens, inputBudget, systemPrompt: options.systemPrompt, userPrompt };
};

const formatSemantics = (semantics: Semantics): string => {
  const semParts: string[] = [];
  if (semantics.functions.length > 0) {
    semParts.push(`Functions: ${semantics.functions.join(', ')}`);
  }
  if (semantics.types.length > 0) {
    semParts.push(`Types: ${semantics.types.join(', ')}`);
  }
  if (semantics.exports.length > 0) {
    semParts.push(`Exports: ${semantics.exports.join(', ')}`);
  }
  if (semantics.classes.length > 0) {
    semParts.push(`Classes: ${semantics.classes.join(', ')}`);
  }
  return semParts.join('\n');
};

const buildCommitTypeSection = (): string => {
  const typeDescriptions = Object.entries(COMMIT_TYPES)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');

  return `## Commit Types
${typeDescriptions}

## Rules
- Max 72 characters
- Format: type(scope): description OR type: description
- Focus on WHY not WHAT
- Prefer the current diff over all other context
- Recent commits are style hints only; do not summarize them instead of the current diff`;
};

const buildSystemPrompt = (): string =>
  `You generate exactly one conventional commit subject for the current staged changes.

You must not reveal reasoning, chain-of-thought, alternatives, markdown, or commentary.
Use the SubmitCommitMessage tool with a single one-line message.
The message must start with a conventional commit type and must be at most 72 characters.`;

const addUserSelectionSection = (sections: string[], selectedType?: string): void => {
  if (selectedType !== undefined && selectedType !== '' && selectedType !== 'auto') {
    const typeDesc = COMMIT_TYPES[selectedType] ?? '';
    sections.push(
      `## User Selection\nThe user indicated this commit is most likely a "${selectedType}" (${typeDesc}).\nUse this type unless absolutely certain another type is more accurate.\nYou can still add a scope in parentheses, e.g., ${selectedType}(scope): description.`,
    );
  }
};

const addRecentCommitsSection = (sections: string[], recentCommits?: readonly string[]): void => {
  if (recentCommits !== undefined && recentCommits.length > 0) {
    const commitList = recentCommits.map((c) => `- ${c}`).join('\n');
    sections.push(
      `## Low-Priority Style Hints From Recent Commits\nUse these only for tone and scope naming. Never choose a message that describes these commits instead of the current diff:\n${commitList}`,
    );
  }
};

const addUserNoteSection = (sections: string[], userInput?: string): void => {
  if (userInput !== undefined && userInput.trim() !== '') {
    sections.push(`## User Note\n${userInput.trim()}`);
  }
};

const addCodeChangesSection = (sections: string[], semantics: Semantics): void => {
  if (
    semantics.functions.length > 0 ||
    semantics.types.length > 0 ||
    semantics.exports.length > 0
  ) {
    sections.push(`## Code Changes\n${formatSemantics(semantics)}`);
  }
};

const addFilesSection = (sections: string[], fileList?: string): void => {
  if (fileList !== undefined && fileList !== '') {
    sections.push(`## Files\n${fileList}`);
  }
};

const addDiffSection = (sections: string[], compressedDiffs?: string): void => {
  if (compressedDiffs !== undefined && compressedDiffs !== '') {
    sections.push(`## Diff\n${compressedDiffs}`);
  }
};

const buildPrompt = (options: BuildPromptOptions): string => {
  const sections: string[] = [
    'Generate one conventional commit message for the current diff below.',
  ];

  addUserSelectionSection(sections, options.selectedType);
  addUserNoteSection(sections, options.userInput);
  sections.push(`## Stats\n${options.stats}`);
  addCodeChangesSection(sections, options.semantics);
  addFilesSection(sections, options.fileList);
  addDiffSection(sections, options.compressedDiffs);
  addRecentCommitsSection(sections, options.recentCommits);
  sections.push(buildCommitTypeSection());

  return sections.join('\n\n');
};

const buildBudgetedCommitPrompt = (
  options: BuildPromptOptions,
  inputBudget: number,
): BoundedPrompt =>
  buildBoundedPrompt({
    fixedPrefix: 'Generate one conventional commit message for the current diff below.',
    fixedSuffix: buildCommitTypeSection(),
    inputBudget,
    sections: [
      { content: options.selectedType ?? 'auto', title: 'User-selected type' },
      { content: options.userInput || '(none)', title: 'User note' },
      { content: options.stats, title: 'Stats' },
      { content: options.compressedDiffs, title: 'Compressed diff' },
      { content: options.fileList, title: 'Files changed' },
      { content: formatSemantics(options.semantics), title: 'Code changes' },
      { content: options.recentCommits?.join('\n') ?? '(none)', title: 'Recent commits' },
    ],
    systemPrompt: buildSystemPrompt(),
  });

export { buildBoundedPrompt, buildBudgetedCommitPrompt, buildPrompt, buildSystemPrompt };
export type { BoundedPrompt, BuildBoundedPromptOptions, PromptSection };
