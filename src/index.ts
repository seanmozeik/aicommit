#!/usr/bin/env bun

import * as p from '@clack/prompts';
import {
  buildPrompt,
  COMMIT_TYPES,
  generateWithAnthropic,
  generateWithClaude,
  generateWithCloudflare,
  generateWithOpenAI,
  validateMessage
} from './lib/ai.js';
import { getConfig, setConfig, deleteConfig } from './lib/secrets.js';
import { PROVIDERS, type SecretsConfig, type Provider } from './lib/config.js';
import { copyToClipboard } from './lib/clipboard.js';
// Library modules
import { classifyFiles, compressDiffs, parseUnifiedDiff } from './lib/diff-parser.js';
import {
  cdToGitRoot,
  commit,
  getHeadDiff,
  getRecentCommitMessages,
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
import type { GenerateResult, ReleaseType } from './types.js';
// UI components
import { showBanner } from './ui/banner.js';
import { displayCommitMessage, displayContextPanel } from './ui/context-panel.js';
import { frappe, theme } from './ui/theme.js';
// Import package.json directly so Bun embeds it at compile time
import packageJson from '../package.json';

// ============================================================================
// CLI Arguments
// ============================================================================

const args = Bun.argv.slice(2);
const command = args[0];
const version = packageJson.version;

// Handle --version flag
if (args.includes('--version') || args.includes('-v')) {
  console.log(`aic v${version}`);
  process.exit(0);
}

// Handle --help flag
if (args.includes('--help') || args.includes('-h')) {
  showBanner();
  console.log(`aic v${version} - AI Commit Message Generator\n`);
  console.log('Usage: aic [command] [options]\n');
  console.log('Commands:');
  console.log('  (default)          Generate a commit message from staged/unstaged changes');
  console.log('  setup              Configure Cloudflare AI credentials');
  console.log('  teardown           Remove stored credentials');
  console.log('  release <type>     Create a release (patch|minor|major)');
  console.log('  release-init       Initialize release configuration');
  console.log('  changelog-latest   Output the latest changelog entry\n');
  console.log('Options:');
  console.log('  --provider <name>  AI provider (cloudflare|claude|anthropic|openai)');
  console.log('  --version, -v      Show version number');
  console.log('  --help, -h         Show this help message\n');
  process.exit(0);
}

// ============================================================================
// Setup Command - Interactive secret configuration
// ============================================================================

async function setupSecrets() {
  showBanner();
  p.intro(frappe.text('Setup AI Provider'));

  // Load existing config to preserve other providers
  const existingConfig = await getConfig();

  // Provider selection
  const providerOptions = Object.entries(PROVIDERS).map(([key, info]) => ({
    value: key as Provider,
    label: info.name,
    hint: info.description
  }));

  const selectedProvider = await p.select({
    message: 'Select provider to configure:',
    options: providerOptions
  });

  if (p.isCancel(selectedProvider)) {
    p.outro(frappe.subtext1('Cancelled'));
    process.exit(0);
  }

  const provider = selectedProvider as Provider;
  const providerInfo = PROVIDERS[provider];

  // Collect credentials based on provider
  let newConfig: SecretsConfig = existingConfig ?? {
    defaultProvider: provider,
    providers: {}
  };

  if (provider === 'cloudflare') {
    const accountId = await p.text({
      message: 'Cloudflare Account ID:',
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

    newConfig.providers.cloudflare = {
      accountId: accountId.trim(),
      apiToken: apiToken.trim()
    };
  } else if (provider === 'anthropic') {
    const apiKey = await p.password({
      message: 'Anthropic API Key:',
      validate: (v) => (v.trim() ? undefined : 'API Key is required')
    });
    if (p.isCancel(apiKey)) {
      p.outro(frappe.subtext1('Cancelled'));
      process.exit(0);
    }

    newConfig.providers.anthropic = { apiKey: apiKey.trim() };
  } else if (provider === 'openai') {
    const apiKey = await p.password({
      message: 'OpenAI API Key:',
      validate: (v) => (v.trim() ? undefined : 'API Key is required')
    });
    if (p.isCancel(apiKey)) {
      p.outro(frappe.subtext1('Cancelled'));
      process.exit(0);
    }

    newConfig.providers.openai = { apiKey: apiKey.trim() };
  } else if (provider === 'claude') {
    // Validate claude CLI is installed
    const proc = Bun.spawn({ cmd: ['which', 'claude'], stdout: 'pipe', stderr: 'pipe' });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      p.log.error('Claude CLI not found. Install it from: https://claude.ai/download');
      process.exit(1);
    }
    p.log.success('Claude CLI found');
  }

  // Ask if this should be the default
  if (existingConfig && existingConfig.defaultProvider !== provider) {
    const makeDefault = await p.confirm({
      message: `Set ${providerInfo.name} as default provider?`,
      initialValue: true
    });
    if (!p.isCancel(makeDefault) && makeDefault) {
      newConfig.defaultProvider = provider;
    }
  } else {
    newConfig.defaultProvider = provider;
  }

  const s = p.spinner();
  s.start('Saving configuration...');

  try {
    await setConfig(newConfig);
    s.stop(theme.success('Configuration saved'));
    p.outro(theme.success(`${providerInfo.name} configured! Run aic to generate commit messages.`));
  } catch (err) {
    s.stop(theme.error('Failed to save configuration'));
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

  const existingConfig = await getConfig();

  if (!existingConfig) {
    p.outro(frappe.subtext1('No credentials stored'));
    process.exit(0);
  }

  // List configured providers
  const configuredProviders = Object.keys(existingConfig.providers) as Provider[];
  if (configuredProviders.length === 0 && existingConfig.defaultProvider === 'claude') {
    // Only claude configured, no credentials to remove
    const confirm = await p.confirm({
      message: 'Remove configuration? (Claude CLI has no stored credentials)'
    });
    if (p.isCancel(confirm) || !confirm) {
      p.outro(frappe.subtext1('Cancelled'));
      process.exit(0);
    }
    await deleteConfig();
    p.outro(theme.success('Configuration removed'));
    process.exit(0);
  }

  const removeOptions = [
    { value: 'all', label: 'Remove all credentials', hint: 'Delete entire configuration' },
    ...configuredProviders.map((key) => ({
      value: key,
      label: `Remove ${PROVIDERS[key].name}`,
      hint: key === existingConfig.defaultProvider ? '(current default)' : undefined
    }))
  ];

  const selected = await p.select({
    message: 'What would you like to remove?',
    options: removeOptions
  });

  if (p.isCancel(selected)) {
    p.outro(frappe.subtext1('Cancelled'));
    process.exit(0);
  }

  const s = p.spinner();
  s.start('Removing credentials...');

  try {
    if (selected === 'all') {
      await deleteConfig();
      s.stop(theme.success('All credentials removed'));
    } else {
      const providerToRemove = selected as keyof typeof existingConfig.providers;
      delete existingConfig.providers[providerToRemove];

      // If removing default provider, pick a new default
      if (existingConfig.defaultProvider === providerToRemove) {
        const remaining = Object.keys(existingConfig.providers) as Provider[];
        existingConfig.defaultProvider = remaining[0] ?? 'claude';
      }

      await setConfig(existingConfig);
      s.stop(theme.success(`${PROVIDERS[providerToRemove as Provider].name} credentials removed`));
    }
    p.outro(frappe.subtext1('Done'));
  } catch (err) {
    s.stop(theme.error('Failed to remove credentials'));
    p.log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ============================================================================
// Handle Subcommands
// ============================================================================

// Change to git root for all git-related commands
if (command !== 'setup' && command !== 'teardown') {
  await cdToGitRoot();
}

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
} else if (command === 'changelog-latest') {
  // Output latest changelog entry to stdout (for use in scripts)
  const { getLatestChangelogEntry } = await import('./lib/changelog.js');
  const entry = await getLatestChangelogEntry();
  if (entry) {
    console.log(entry);
  } else {
    console.error('No changelog entries found');
    process.exit(1);
  }
} else {
  // Parse provider flag for main command
  const providerIndex = args.indexOf('--provider');
  const providerArg = providerIndex !== -1 ? args[providerIndex + 1] : null;

  // Validate provider if specified
  const validProviders: Provider[] = ['cloudflare', 'claude', 'anthropic', 'openai'];
  if (providerArg && !validProviders.includes(providerArg as Provider)) {
    console.error(`Invalid --provider. Use one of: ${validProviders.join(', ')}`);
    process.exit(1);
  }

  // ============================================================================
  // Main Flow
  // ============================================================================

  async function main() {
    // Show banner
    showBanner();

    // Load configuration
    const config = await getConfig();
    const provider: Provider = (providerArg as Provider) ?? config?.defaultProvider ?? 'cloudflare';

    // Validate provider is configured (except claude which needs no credentials)
    if (provider !== 'claude') {
      if (!config) {
        p.outro(theme.error(`No configuration found. Run: aic setup`));
        process.exit(1);
      }
      if (provider === 'cloudflare' && !config.providers.cloudflare) {
        p.outro(theme.error('Cloudflare not configured. Run: aic setup'));
        process.exit(1);
      }
      if (provider === 'anthropic' && !config.providers.anthropic) {
        p.outro(theme.error('Anthropic not configured. Run: aic setup'));
        process.exit(1);
      }
      if (provider === 'openai' && !config.providers.openai) {
        p.outro(theme.error('OpenAI not configured. Run: aic setup'));
        process.exit(1);
      }
    }

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

    // Get commit type selection
    const typeOptions = [
      { hint: 'Let AI choose the best type', label: 'auto', value: 'auto' },
      ...Object.entries(COMMIT_TYPES).map(([type, desc]) => ({
        hint: desc,
        label: type,
        value: type
      }))
    ];

    const selectedType = await p.select({
      initialValue: 'auto',
      message: 'Commit type:',
      options: typeOptions
    });

    if (p.isCancel(selectedType)) {
      p.outro(frappe.subtext1('Cancelled'));
      process.exit(0);
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
    const recentCommits = await getRecentCommitMessages(3);

    // Build prompt
    const prompt = buildPrompt(
      userInput || '',
      stats,
      semantics,
      fileList.join('\n'),
      compressedDiffs,
      selectedType as string,
      recentCommits
    );

    // Helper to generate commit message with spinner
    async function generateMessage(): Promise<string> {
      const s = p.spinner();
      s.start(frappe.subtext1(`Generating with ${provider}...`));

      try {
        let response: GenerateResult;
        switch (provider) {
          case 'claude':
            response = await generateWithClaude(prompt);
            break;
          case 'anthropic':
            response = await generateWithAnthropic(prompt, config!);
            break;
          case 'openai':
            response = await generateWithOpenAI(prompt, config!);
            break;
          case 'cloudflare':
          default:
            response = await generateWithCloudflare(prompt, config!);
            break;
        }
        const message = validateMessage(response.text);
        const usage = response.usage;
        if (usage) {
          s.stop(frappe.subtext1(`Done (in: ${usage.input_tokens}, out: ${usage.output_tokens})`));
        } else {
          s.stop(frappe.subtext1('Done'));
        }
        return message;
      } catch (err) {
        s.stop(theme.error('Failed'));
        throw err;
      }
    }

    // Start AI generation in background immediately (runs while we display panels)
    const aiPromise = generateMessage();

    // Display context panel (AI is already running in background)
    await displayContextPanel(classified, parsed.totalAdditions, parsed.totalDeletions);

    let commitMessage: string;
    try {
      commitMessage = await aiPromise;
    } catch (err) {
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
          { hint: 'regenerate message', label: 'Retry', value: 'retry' },
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

      if (action === 'retry') {
        try {
          finalMessage = await generateMessage();
          displayCommitMessage(finalMessage);
        } catch (err) {
          p.log.error(err instanceof Error ? err.message : String(err));
        }
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
