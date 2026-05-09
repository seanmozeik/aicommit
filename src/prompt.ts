import { COMMIT_TYPES } from './commit-types';

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

export { buildPrompt, buildSystemPrompt };
