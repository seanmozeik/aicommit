import * as p from '@clack/prompts';
import { Effect } from 'effect';
import { Command, Flag } from 'effect/unstable/cli';

import {
  COMMIT_TYPES,
  buildPrompt,
  generateWithClaude,
  generateWithOpenAICompatible,
  validateMessage,
} from './ai.js';
import { classifyFiles, compressDiffs, parseUnifiedDiff } from './diff-parser.js';
import {
  cdToGitRoot,
  commit,
  getHeadDiff,
  getRecentCommitMessages,
  getStagedDiff,
  getStagedFiles,
  getStatus,
  hasHead,
  isGitRepo,
  parseStatusOutput,
  push,
  stageFiles,
} from './git.js';
import { loadDefaultPreset, loadPreset, listPresets } from './secrets.js';
import { extractSemantics, formatStats } from './semantic.js';
import { showBanner } from './ui/banner.js';
import { displayCommitMessage, displayContextPanel } from './ui/context-panel.js';
import { frappeColors, theme } from './ui/theme.js';

export const commitCommand = Command.make(
  'commit',
  { preset: Flag.optional(Flag.string('preset')) },
  ({ preset }) =>
    Effect.gen(function* commitCommand() {
      // Change to git root
      const inRepo = yield* Effect.tryPromise({ catch: () => false, try: () => cdToGitRoot() });

      if (!inRepo) {
        console.error(theme.error('Not a git repository'));
        process.exit(1);
      }

      // Show banner
      showBanner();

      // Load configuration
      const configDefault = yield* Effect.tryPromise(() => loadDefaultPreset());
      const selectedPreset = preset ?? configDefault;

      // Validate preset exists (claude is a special built-in preset)
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
        : yield* Effect.tryPromise(() => loadPreset(presetName));

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
      if (!hasStaged && headExists) {
        const statusOutput = yield* Effect.tryPromise(() => getStatus());

        if (statusOutput) {
          const changedFiles = parseStatusOutput(statusOutput);

          if (changedFiles.length > 0 && changedFiles.length <= 15) {
            const selected = yield* Effect.tryPromise({
              catch: (error) => {
                p.outro(frappeColors.subtext1('Cancelled'));
                process.exit(0);
                throw new Error('Cancelled');
              },
              try: () =>
                p.multiselect({
                  message: 'Select files to stage:',
                  options: [
                    { hint: 'generate from all changes', label: 'Skip', value: '__skip__' },
                    ...changedFiles.map((f) => ({ hint: f.hint, label: f.path, value: f.path })),
                  ],
                }) as Promise<string[]>,
            });

            const filesToStage = selected.filter((f) => f !== '__skip__');
            if (filesToStage.length > 0) {
              try {
                yield* Effect.tryPromise(() => stageFiles(filesToStage));
                hasStaged = true;
              } catch (error) {
                p.log.error(
                  `Failed to stage files: ${error instanceof Error ? error.message : error}`,
                );
                p.outro(theme.error('Aborted'));
                process.exit(1);
              }
            }
          }
        }
      }

      // Get commit type selection
      const typeOptions = [
        { hint: 'Let AI choose the best type', label: 'auto', value: 'auto' },
        ...Object.entries(COMMIT_TYPES).map(([type, desc]) => ({
          hint: desc,
          label: type,
          value: type,
        })),
      ];

      const selectedType = yield* Effect.tryPromise({
        catch: (error) => {
          p.outro(frappeColors.subtext1('Cancelled'));
          process.exit(0);
          throw new Error('Cancelled');
        },
        try: () =>
          p.select({
            initialValue: 'auto',
            message: 'Commit type:',
            options: typeOptions,
          }) as Promise<string>,
      });

      // Get user description
      const userInput = yield* Effect.tryPromise({
        catch: (error) => {
          p.outro(frappeColors.subtext1('Cancelled'));
          process.exit(0);
          throw new Error('Cancelled');
        },
        try: () =>
          p.text({
            defaultValue: '',
            message: 'Describe your changes (optional):',
          }) as Promise<string>,
      });

      // Get diff
      let diffOutput: string;
      try {
        if (hasStaged) {
          p.log.info(frappeColors.subtext1('Using staged files only'));
          diffOutput = yield* Effect.tryPromise(() => getStagedDiff());
        } else if (!headExists) {
          p.outro(theme.warning('Initial commit: stage files first with "git add"'));
          process.exit(0);
        } else {
          diffOutput = yield* Effect.tryPromise(() => getHeadDiff());
        }
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

      // Extract semantics and compress diffs
      const semantics = extractSemantics(classified.included);
      const compressedDiffs = compressDiffs(classified.included);
      const stats = formatStats(classified, parsed.totalAdditions, parsed.totalDeletions);
      const recentCommits = yield* Effect.tryPromise(() => getRecentCommitMessages(3));

      // Build prompt
      const prompt = buildPrompt({
        compressedDiffs,
        fileList: fileList.join('\n'),
        recentCommits,
        selectedType,
        semantics,
        stats,
        userInput: userInput ?? '',
      });

      // Helper to generate commit message with spinner
      const generateMessage = Effect.gen(function* generateMessage() {
        const s = p.spinner();
        s.start(frappeColors.subtext1(`Generating with preset "${presetName}"...`));

        const message = yield* isClaudePreset
          ? generateWithClaude(prompt)
          : generateWithOpenAICompatible(prompt, presetConfig!);
        const validated = validateMessage(message);
        s.stop(frappeColors.subtext1('Done'));
        return validated;
      }).pipe(
        Effect.catchTags({
          ApiResponseError: (error) => {
            p.spinner().stop(theme.error('Failed'));
            p.log.error(`API response error: ${error.message}`);
            return Effect.die(error);
          },
          ClaudeCliError: (error) => {
            p.spinner().stop(theme.error('Failed'));
            p.log.error(`Claude CLI error (exit code ${error.exitCode}): ${error.message}`);
            return Effect.die(error);
          },
          OpenAiApiError: (error) => {
            p.spinner().stop(theme.error('Failed'));
            p.log.error(`API error (${error.statusCode}): ${error.message}`);
            return Effect.die(error);
          },
        }),
      );

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

      // Action menu
      let finalMessage = commitMessage;

      while (true) {
        const action = yield* Effect.tryPromise({
          catch: (error) => {
            p.outro(frappeColors.subtext1('Cancelled'));
            process.exit(0);
            throw new Error('Cancelled');
          },
          try: () =>
            p.select({
              message: 'What would you like to do?',
              options: [
                ...(hasStaged ? [{ hint: 'staged files', label: 'Commit', value: 'commit' }] : []),
                { hint: 'modify the message', label: 'Edit', value: 'edit' },
                { hint: 'regenerate message', label: 'Retry', value: 'retry' },
                { label: 'Copy to clipboard', value: 'copy' },
                { label: 'Cancel', value: 'cancel' },
              ],
            }) as Promise<string>,
        });

        if (action === 'cancel') {
          p.outro(frappeColors.subtext1('Done'));
          process.exit(0);
        }

        if (action === 'edit') {
          const edited = yield* Effect.tryPromise({
            catch: (error) => {
              p.outro(frappeColors.subtext1('Cancelled'));
              process.exit(0);
              throw new Error('Cancelled');
            },
            try: () =>
              p.text({
                initialValue: finalMessage,
                message: 'Edit commit message:',
              }) as Promise<string>,
          });
          finalMessage = edited;
          displayCommitMessage(finalMessage);
          continue;
        }

        if (action === 'retry') {
          const newMessage = yield* generateMessage;
          finalMessage = newMessage;
          displayCommitMessage(finalMessage);
          continue;
        }

        if (action === 'commit') {
          try {
            yield* Effect.tryPromise(() => commit(finalMessage));
          } catch (error) {
            p.log.error(`Commit failed: ${error instanceof Error ? error.message : error}`);
            p.outro(theme.error('Aborted'));
            process.exit(1);
          }

          const shouldPush = yield* Effect.tryPromise({
            catch: (error) => {
              p.outro(frappeColors.subtext1('Cancelled'));
              process.exit(0);
              throw new Error('Cancelled');
            },
            try: () => p.confirm({ message: 'Push to remote?' }) as Promise<boolean>,
          });

          if (!shouldPush) {
            p.outro(theme.success('Committed!'));
            process.exit(0);
          }

          try {
            yield* Effect.tryPromise(() => push());
          } catch (error) {
            p.log.error(`Push failed: ${error instanceof Error ? error.message : error}`);
            p.outro(theme.warning('Committed locally, but push failed'));
            process.exit(1);
          }
          p.outro(theme.success('Committed and pushed!'));
          process.exit(0);
        }

        if (action === 'copy') {
          try {
            yield* Effect.tryPromise(() => Bun.write('/tmp/aic-commit.txt', finalMessage));
            p.outro(theme.success('Copied to clipboard!'));
          } catch {
            p.log.warn('No clipboard tool found.');
            p.outro(finalMessage);
          }
          process.exit(0);
        }
      }
    }),
);
