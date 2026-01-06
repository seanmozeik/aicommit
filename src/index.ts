#!/usr/bin/env bun

import * as p from '@clack/prompts';
import {
  buildPrompt,
  deleteSecret,
  generateWithClaude,
  generateWithCloudflare,
  setSecret,
  validateMessage
} from './lib/ai.js';
import { copyToClipboard } from './lib/clipboard.js';
// Library modules
import { classifyFiles, compressDiffs, parseUnifiedDiff } from './lib/diff-parser.js';
import {
  commit,
  getHeadDiff,
  getStagedDiff,
  getStagedFiles,
  getStatus,
  getSubmodulePaths,
  hasHead,
  isGitRepo,
  parseStatusOutput,
  push,
  stageFiles
} from './lib/git.js';
import { initRelease, interactiveRelease } from './lib/release.js';
import { extractSemantics, formatStats } from './lib/semantic.js';
import type { ModelType, ReleaseType } from './types.js';
// UI components
import { showBanner } from './ui/banner.js';
import { displayCommitMessage, displayContextPanel } from './ui/context-panel.js';
import { frappe, theme } from './ui/theme.js';

// ============================================================================
// CLI Arguments
// ============================================================================

const args = Bun.argv.slice(2);
const command = args[0];

// ============================================================================
// Setup Command - Interactive secret configuration
// ============================================================================

async function setupSecrets() {
  showBanner();
  p.intro(frappe.text('Setup Cloudflare AI credentials'));

  const accountId = await p.text({
    message: 'Cloudflare Account ID:',
    placeholder: 'your-account-id',
    validate: (v) => (v.trim() ? undefined : 'Account ID is required')
  });

  if (p.isCancel(accountId)) {
    p.outro(frappe.subtext1('Cancelled'));
    process.exit(0);
  }

  const apiToken = await p.password({
    message: 'Cloudflare API Token:',
    validate: (v) => (v.trim() ? undefined : 'API Token is required')
  });

  if (p.isCancel(apiToken)) {
    p.outro(frappe.subtext1('Cancelled'));
    process.exit(0);
  }

  const s = p.spinner();
  s.start('Storing secrets...');

  try {
    await setSecret('AIC_CLOUDFLARE_ACCOUNT_ID', accountId.trim());
    await setSecret('AIC_CLOUDFLARE_API_TOKEN', apiToken.trim());
    s.stop(theme.success('Secrets stored securely'));
    p.outro(theme.success('Setup complete! Run aic to generate commit messages.'));
  } catch (err) {
    s.stop(theme.error('Failed to store secrets'));
    p.log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ============================================================================
// Teardown Command - Remove stored secrets
// ============================================================================

async function teardownSecrets() {
  showBanner();
  p.intro(frappe.text('Remove stored credentials'));

  const confirm = await p.confirm({
    message: 'Remove all stored secrets?'
  });

  if (p.isCancel(confirm) || !confirm) {
    p.outro(frappe.subtext1('Cancelled'));
    process.exit(0);
  }

  const s = p.spinner();
  s.start('Removing secrets...');

  try {
    const results = await Promise.all([
      deleteSecret('AIC_CLOUDFLARE_ACCOUNT_ID'),
      deleteSecret('AIC_CLOUDFLARE_API_TOKEN')
    ]);

    const removed = results.filter(Boolean).length;
    s.stop(theme.success(`Removed ${removed} secret(s)`));
    p.outro(frappe.subtext1('Done'));
  } catch (err) {
    s.stop(theme.error('Failed to remove secrets'));
    p.log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ============================================================================
// Handle Subcommands
// ============================================================================

if (command === 'setup') {
  setupSecrets();
} else if (command === 'teardown') {
  teardownSecrets();
} else if (command === 'release') {
  // aic release [patch|minor|major]
  const releaseType = args[1] as ReleaseType | undefined;
  if (!releaseType || !['patch', 'minor', 'major'].includes(releaseType)) {
    showBanner();
    console.log('Usage: aic release <patch|minor|major>');
    console.log('');
    console.log('Examples:');
    console.log('  aic release patch   # 1.0.0 → 1.0.1');
    console.log('  aic release minor   # 1.0.0 → 1.1.0');
    console.log('  aic release major   # 1.0.0 → 2.0.0');
    console.log('');
    console.log('Run "aic release init" to set up release configuration');
    process.exit(1);
  }
  showBanner();
  interactiveRelease(releaseType);
} else if (command === 'release-init') {
  // aic release-init - Initialize release configuration
  showBanner();
  initRelease();
} else {
  // Parse model flag for main command
  const modelIndex = args.indexOf('--model');
  const model: ModelType = modelIndex !== -1 ? (args[modelIndex + 1] as ModelType) : 'cloudflare';

  if (model !== 'cloudflare' && model !== 'claude') {
    console.error('Invalid --model. Use "cloudflare" (default) or "claude"');
    process.exit(1);
  }

  // ============================================================================
  // Main Flow
  // ============================================================================

  async function main() {
    // Show banner
    showBanner();

    // Check if we're in a git repo
    if (!(await isGitRepo())) {
      p.outro(theme.error('Not a git repository'));
      process.exit(1);
    }

    // Check for staged files
    const stagedFiles = await getStagedFiles();
    let hasStaged = stagedFiles.length > 0;

    // Check if HEAD exists (false for initial commit)
    const headExists = await hasHead();

    // If no files staged and we have HEAD, offer file selection
    if (!hasStaged && headExists) {
      const submodulePaths = await getSubmodulePaths();
      const statusOutput = await getStatus();

      if (statusOutput) {
        const changedFiles = parseStatusOutput(statusOutput).filter(
          (f) => !submodulePaths.has(f.path)
        );

        if (changedFiles.length > 0 && changedFiles.length <= 15) {
          const selected = await p.multiselect({
            message: 'Select files to stage:',
            options: [
              { hint: 'generate from all changes', label: 'Skip', value: '__skip__' },
              ...changedFiles.map((f) => ({
                hint: f.hint,
                label: f.path,
                value: f.path
              }))
            ]
          });

          if (p.isCancel(selected)) {
            p.outro(frappe.subtext1('Cancelled'));
            process.exit(0);
          }

          const filesToStage = (selected as string[]).filter((f) => f !== '__skip__');
          if (filesToStage.length > 0) {
            try {
              await stageFiles(filesToStage);
              hasStaged = true;
            } catch (err) {
              p.log.error(`Failed to stage files: ${err instanceof Error ? err.message : err}`);
              p.outro(theme.error('Aborted'));
              process.exit(1);
            }
          }
        }
      }
    }

    // Get user description
    const userInput = await p.text({
      defaultValue: '',
      message: 'Describe your changes (optional):'
    });

    if (p.isCancel(userInput)) {
      p.outro(frappe.subtext1('Cancelled'));
      process.exit(0);
    }

    // Get diff
    let diffOutput: string;
    try {
      if (hasStaged) {
        p.log.info(frappe.subtext1('Using staged files only'));
        diffOutput = await getStagedDiff();
      } else if (!headExists) {
        p.outro(theme.warning('Initial commit: stage files first with "git add"'));
        process.exit(0);
      } else {
        diffOutput = await getHeadDiff();
      }
    } catch (err) {
      p.log.error(`Failed to get diff: ${err instanceof Error ? err.message : err}`);
      p.outro(theme.error('Aborted'));
      process.exit(1);
    }

    if (!diffOutput.trim()) {
      p.outro(frappe.subtext1('No changes to commit'));
      process.exit(0);
    }

    // Parse and classify files
    const parsed = parseUnifiedDiff(diffOutput);
    const classified = classifyFiles(parsed.files);

    if (classified.included.length === 0 && classified.summarized.length === 0) {
      p.outro(frappe.subtext1('No relevant changes (all files excluded)'));
      process.exit(0);
    }

    // Build file list for prompt
    const fileList: string[] = [];
    if (classified.included.length > 0)
      fileList.push(classified.included.map((f) => f.path).join(', '));
    if (classified.summarized.length > 0)
      fileList.push(`(summarized: ${classified.summarized.map((f) => f.path).join(', ')})`);
    if (classified.excluded.length > 0)
      fileList.push(`(excluded: ${classified.excluded.length} files)`);

    // Extract semantics and compress diffs
    const semantics = extractSemantics(classified.included);
    const compressedDiffs = compressDiffs(classified.included);
    const stats = formatStats(classified, parsed.totalAdditions, parsed.totalDeletions);

    // Build prompt
    const prompt = buildPrompt(
      userInput || '',
      stats,
      semantics,
      fileList.join('\n'),
      compressedDiffs
    );

    // Start AI generation in background immediately (runs while we display panels)
    const aiPromise = (async () => {
      const response =
        model === 'claude'
          ? await generateWithClaude(prompt)
          : await generateWithCloudflare(prompt);
      return { message: validateMessage(response.text), usage: response.usage };
    })();

    // Display context panel (AI is already running in background)
    await displayContextPanel(classified, parsed.totalAdditions, parsed.totalDeletions);

    // Show spinner while waiting for AI to complete
    const s = p.spinner();
    s.start(frappe.subtext1(`Generating with ${model}...`));

    let commitMessage: string;
    try {
      const result = await aiPromise;
      commitMessage = result.message;
      const usage = result.usage;
      if (usage) {
        const neurons = Math.round(usage.input_tokens * 0.018182 + usage.output_tokens * 0.027273);
        s.stop(
          frappe.subtext1(
            `Done (in: ${usage.input_tokens}, out: ${usage.output_tokens}, ~${neurons} neurons)`
          )
        );
      } else {
        s.stop(frappe.subtext1('Done'));
      }
    } catch (err) {
      s.stop(theme.error('Failed'));
      p.log.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    // Display the commit message in styled box
    displayCommitMessage(commitMessage);

    // Action menu
    let finalMessage = commitMessage;

    while (true) {
      const action = await p.select({
        message: 'What would you like to do?',
        options: [
          ...(hasStaged ? [{ hint: 'staged files', label: 'Commit', value: 'commit' }] : []),
          { hint: 'modify the message', label: 'Edit', value: 'edit' },
          { label: 'Copy to clipboard', value: 'copy' },
          { label: 'Cancel', value: 'cancel' }
        ]
      });

      if (p.isCancel(action) || action === 'cancel') {
        p.outro(frappe.subtext1('Done'));
        process.exit(0);
      }

      if (action === 'edit') {
        const edited = await p.text({
          initialValue: finalMessage,
          message: 'Edit commit message:'
        });

        if (p.isCancel(edited)) continue;
        finalMessage = edited as string;
        displayCommitMessage(finalMessage);
        continue;
      }

      if (action === 'commit') {
        try {
          await commit(finalMessage);
        } catch (err) {
          p.log.error(`Commit failed: ${err instanceof Error ? err.message : err}`);
          p.outro(theme.error('Aborted'));
          process.exit(1);
        }

        const shouldPush = await p.confirm({ message: 'Push to remote?' });

        if (p.isCancel(shouldPush) || !shouldPush) {
          p.outro(theme.success('Committed!'));
          process.exit(0);
        }

        try {
          await push();
        } catch (err) {
          p.log.error(`Push failed: ${err instanceof Error ? err.message : err}`);
          p.outro(theme.warning('Committed locally, but push failed'));
          process.exit(1);
        }
        p.outro(theme.success('Committed and pushed!'));
        process.exit(0);
      }

      if (action === 'copy') {
        const copied = await copyToClipboard(finalMessage);
        if (copied) {
          p.outro(theme.success('Copied to clipboard!'));
        } else {
          p.log.warn('No clipboard tool found. Install xclip, xsel, or wl-copy.');
          p.outro(finalMessage);
        }
        process.exit(0);
      }
    }
  }

  // Run
  main().catch((err) => {
    console.error(theme.error(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  });
}
