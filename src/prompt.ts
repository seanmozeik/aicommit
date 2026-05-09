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

CRITICAL INSTRUCTIONS:
1. Reply with ONLY the commit message itself
2. Do NOT include any explanations, reasoning, or commentary
3. Do NOT start with newlines, blank lines, or whitespace
4. Do NOT use quotes around your response
5. Output must begin immediately with the commit type (e.g., "feat:", "fix:")
6. Your entire output should be exactly one line containing only the commit message`;
};

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
      `## Recent Project Activity\nThese are the most recent commits in this repository, showing what the developer has been working on. Use this context to better understand how the current changes fit into the ongoing work:\n${commitList}`,
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

export const buildPrompt = (options: BuildPromptOptions): string => {
  const sections: string[] = ['Generate a conventional commit message.'];

  addUserSelectionSection(sections, options.selectedType);
  addRecentCommitsSection(sections, options.recentCommits);
  addUserNoteSection(sections, options.userInput);
  sections.push(`## Stats\n${options.stats}`);
  addCodeChangesSection(sections, options.semantics);
  addFilesSection(sections, options.fileList);
  addDiffSection(sections, options.compressedDiffs);
  sections.push(buildCommitTypeSection());

  return sections.join('\n\n');
};
