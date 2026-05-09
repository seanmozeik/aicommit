/* oxlint-disable exports-last, import/no-namespace */
import * as p from '@clack/prompts';
import { Effect, Option } from 'effect';
import { Command, Flag } from 'effect/unstable/cli';


import { classifyFiles, compressDiffs, parseUnifiedDiff } from './diff-parser.js';
import {
  cdToGitRoot,
  getHeadDiff,
  getRecentCommitMessages,
  getStagedDiff,
  getStagedFiles,
  hasHead,
  isGitRepo,
} from './git.js';
import { loadDefaultPreset, loadPreset, listPresets, type Preset } from './secrets.js';
import { extractSemantics, formatStats } from './semantic.js';
import { showBanner } from './ui/banner.js';
import { displayCommitMessage, displayContextPanel } from './ui/context-panel.js';
import { frappeColors, theme } from './ui/theme.js';
import { selectFilesToStage } from './cli-commit-file-selection.js';
import {
  generateCommitMessage,
  selectCommitType,
  selectUserDescription,
  type GenerationInput,
} from './cli-commit-generation.js';
import { showActionMenu } from './cli-commit-actions.js';

const DEFAULT_RECENT_COMMITS_COUNT = 3;

const validatePreset = (preset: Option.Option<string>): Effect.Effect<{ presetConfig: Preset | null; presetName: string }, unknown> =>
  Effect.gen(function* validatePresetGen() {
    const configDefault = yield* Effect.tryPromise(() => loadDefaultPreset());
    const selectedPreset = Option.getOrElse(preset, () => configDefault);

    const presets = yield* Effect.tryPromise(() => listPresets());
    const allPresets = [...presets, 'claude'];
    if (presets.length === 0 && !selectedPreset) {
      p.outro(theme.error('No presets configured. Run: aic setup'));
      process.exit(1);
    }
    if (selectedPreset && !allPresets.includes(selectedPreset)) {
      p.outro(theme.error(`Preset "${selectedPreset}" not found. Run: aic setup`));
      process.exit(1);
    }

    const presetName = selectedPreset ?? presets[0] ?? 'claude';
    const isClaudePreset = presetName === 'claude';
    const presetConfig = isClaudePreset
      ? null
      : yield* Effect.tryPromise(() => loadPreset(presetName as string));

    return { presetConfig, presetName };
  });

const getDiffOutput = (hasStaged: boolean, headExists: boolean): Effect.Effect<string, unknown> =>
  Effect.gen(function* getDiffOutputGen() {
    if (hasStaged) {
      p.log.info(frappeColors.subtext1('Using staged files only'));
      return yield* Effect.tryPromise(() => getStagedDiff());
    }
    if (headExists === false) {
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

export const commitCommand = Command.make(
  'commit',
  { preset: Flag.optional(Flag.string('preset')) },
  ({ preset }) =>
    Effect.gen(function* commitCommandGen() {
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
        p.log.error(`Failed to get diff: ${error instanceof Error ? error.message : error}`);
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
      const semantics = extractSemantics(classified.included);
      const compressedDiffs = compressDiffs(classified.included);
      const stats = formatStats(classified, parsed.totalAdditions, parsed.totalDeletions);
      const recentCommits = yield* Effect.tryPromise(() => getRecentCommitMessages(DEFAULT_RECENT_COMMITS_COUNT));

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
        userInput: userInput ?? '',
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
    }),
);