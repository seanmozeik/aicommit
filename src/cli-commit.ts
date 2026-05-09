/* oxlint-disable import/no-namespace */
import * as p from '@clack/prompts';
import { Effect, Option } from 'effect';
import { Command, Flag } from 'effect/unstable/cli';

import { showActionMenu } from './cli-commit-actions';
import { selectFilesToStage } from './cli-commit-file-selection';
import {
  generateCommitMessage,
  getModelBudgets,
  selectCommitType,
  selectUserDescription,
  type GenerationPreset,
  type GenerationInput,
} from './cli-commit-generation.js';
import { classifyFiles, compressDiffs, parseUnifiedDiff } from './diff-parser';
import {
  cdToGitRoot,
  getHeadDiff,
  getRecentCommitMessages,
  getStagedDiff,
  getStagedFiles,
  hasHead,
  isGitRepo,
} from './git.js';
import { loadDefaultPreset, loadPreset, listPresets } from './secrets';
import { extractSemantics, formatStats } from './semantic';
import { showBanner } from './ui/banner';
import { displayCommitMessage, displayContextPanel } from './ui/context-panel';
import { frappeColors, theme } from './ui/theme';

const DEFAULT_RECENT_COMMITS_COUNT = 3;
const NON_DIFF_INPUT_TOKENS = 1500;
const MIN_DIFF_INPUT_TOKENS = 500;
const BUILT_IN_PRESETS = ['claude', 'codex'] as const;
const isBuiltInPreset = (value: string): value is (typeof BUILT_IN_PRESETS)[number] =>
  BUILT_IN_PRESETS.some((preset) => preset === value);

const validatePreset = (
  preset: Option.Option<string>,
): Effect.Effect<{ presetConfig: GenerationPreset; presetName: string }, unknown> =>
  Effect.gen(function* validatePresetGen() {
    const configDefault = yield* Effect.tryPromise(() => loadDefaultPreset());
    const selectedPreset = Option.getOrElse(preset, () => configDefault);

    const presets = yield* Effect.tryPromise(() => listPresets());
    const allPresets = [...presets, ...BUILT_IN_PRESETS];
    if (selectedPreset && !allPresets.includes(selectedPreset)) {
      p.outro(theme.error(`Preset "${selectedPreset}" not found. Run: aic setup`));
      process.exit(1);
    }

    const firstPreset = presets.at(0);
    const presetName = selectedPreset === '' ? (firstPreset ?? 'claude') : selectedPreset;
    const presetConfig = isBuiltInPreset(presetName)
      ? presetName
      : yield* Effect.tryPromise(() => loadPreset(presetName));

    return { presetConfig, presetName };
  });

const getDiffOutput = (hasStaged: boolean, headExists: boolean): Effect.Effect<string, unknown> =>
  Effect.gen(function* getDiffOutputGen() {
    if (hasStaged) {
      p.log.info(frappeColors.subtext1('Using staged files only'));
      return yield* Effect.tryPromise(() => getStagedDiff());
    }
    if (!headExists) {
      p.outro(theme.warning('Initial commit: stage files first with "git add"'));
      process.exit(0);
    }
    return yield* Effect.tryPromise(() => getHeadDiff());
  });

const buildFileList = (classified: ReturnType<typeof classifyFiles>): string => {
  const fileList: string[] = [];
  if (classified.included.length > 0) {
    fileList.push(classified.included.map((f) => f.path).join(', '));
  }
  if (classified.summarized.length > 0) {
    fileList.push(`(summarized: ${classified.summarized.map((f) => f.path).join(', ')})`);
  }
  if (classified.excluded.length > 0) {
    fileList.push(`(excluded: ${classified.excluded.length} files)`);
  }
  return fileList.join('\n');
};

const commitHandler = (preset: Option.Option<string>): Effect.Effect<void, unknown> =>
  Effect.gen(function* commitHandlerGen() {
    // Change to git root
    const inRepo = yield* Effect.tryPromise({ catch: () => false, try: () => cdToGitRoot() });

    if (!inRepo) {
      console.error(theme.error('Not a git repository'));
      process.exit(1);
    }

    // Show banner
    showBanner();

    // Load and validate preset
    const { presetConfig, presetName } = yield* validatePreset(preset);

    // Check if we're in a git repo
    const isRepo = yield* Effect.tryPromise(() => isGitRepo());
    if (!isRepo) {
      p.outro(theme.error('Not a git repository'));
      process.exit(1);
    }

    // Check for staged files
    const stagedFiles = yield* Effect.tryPromise(() => getStagedFiles());
    let hasStaged = stagedFiles.length > 0;

    // Check if HEAD exists (false for initial commit)
    const headExists = yield* Effect.tryPromise(() => hasHead());

    // If no files staged and we have HEAD, offer file selection
    if (headExists && !hasStaged) {
      hasStaged = yield* selectFilesToStage;
    }

    // Get commit type selection
    const selectedType = yield* selectCommitType;

    // Get user description
    const userInput = yield* selectUserDescription;

    // Get diff
    let diffOutput: string;
    try {
      diffOutput = yield* getDiffOutput(hasStaged, headExists);
    } catch (error) {
      p.log.error(`Failed to get diff: ${error instanceof Error ? error.message : String(error)}`);
      p.outro(theme.error('Aborted'));
      process.exit(1);
    }

    if (!diffOutput.trim()) {
      p.outro(frappeColors.subtext1('No changes to commit'));
      process.exit(0);
    }

    // Parse and classify files
    const parsed = parseUnifiedDiff(diffOutput);
    const classified = classifyFiles(parsed.files);

    if (classified.included.length === 0 && classified.summarized.length === 0) {
      p.outro(frappeColors.subtext1('No relevant changes (all files excluded)'));
      process.exit(0);
    }

    // Build file list for prompt
    const fileList = buildFileList(classified);

    // Extract semantics and compress diffs
    const { maxInputTokens } = getModelBudgets(
      typeof presetConfig === 'object' ? presetConfig : null,
    );
    const diffTokenBudget = Math.max(MIN_DIFF_INPUT_TOKENS, maxInputTokens - NON_DIFF_INPUT_TOKENS);
    const semantics = extractSemantics(classified.included);
    const compressedDiffs = compressDiffs(classified.included, { tokenBudget: diffTokenBudget });
    const stats = formatStats(classified, parsed.totalAdditions, parsed.totalDeletions);
    const recentCommits = yield* Effect.tryPromise(() =>
      getRecentCommitMessages(DEFAULT_RECENT_COMMITS_COUNT),
    );

    // Helper to generate commit message with spinner
    const generateMessage = generateCommitMessage({
      compressedDiffs,
      fileList,
      presetConfig,
      presetName,
      recentCommits,
      selectedType,
      semantics,
      stats,
      userInput,
    } as GenerationInput);

    // Start AI generation in background immediately (runs while we display panels)
    const aiPromise = Effect.runPromise(generateMessage);

    // Display context panel (AI is already running in background)
    yield* Effect.tryPromise(() =>
      displayContextPanel(classified, parsed.totalAdditions, parsed.totalDeletions),
    );

    let commitMessage: string;
    try {
      commitMessage = yield* Effect.tryPromise(() => aiPromise);
    } catch (error) {
      p.log.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }

    // Display the commit message in styled box
    displayCommitMessage(commitMessage);

    // Show action menu
    yield* showActionMenu(hasStaged)(commitMessage, generateMessage);
  });

export const commitCommand = Command.make(
  'commit',
  { preset: Flag.optional(Flag.string('preset')) },
  ({ preset }) => commitHandler(preset),
);

export { commitHandler };
