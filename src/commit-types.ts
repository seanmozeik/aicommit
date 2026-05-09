export const COMMIT_TYPES: Record<string, string> = {
  build: 'Build system or external dependency changes',
  chore: 'Maintenance tasks, no production code change',
  ci: 'CI/CD configuration changes',
  docs: 'Documentation only changes',
  feat: 'A new feature for the user',
  fix: 'A bug fix',
  perf: 'Performance improvements',
  refactor: 'Code restructuring without changing behavior',
  revert: 'Reverting a previous commit',
  style: 'Formatting, whitespace, or style changes',
  test: 'Adding or updating tests',
};
