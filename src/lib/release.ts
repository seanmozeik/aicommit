import * as p from '@clack/prompts';
import type { ReleaseType } from '../types.js';
import { theme } from '../ui/theme.js';
import {
  executeSectionWithProgress,
  hasAicConfig,
  initAicConfig,
  parseAicConfig
} from './aic-script.js';
import {
  detectChangelogConvention,
  formatChangelogEntry,
  generateChangelog,
  initializeChangelog,
  writeChangelog
} from './changelog.js';
import {
  commit,
  createTag,
  getLatestTag,
  isGitRepo,
  pushWithTags,
  stageFiles,
  tagExists
} from './git.js';
import { bumpVersion, detectProject, updateProjectVersion } from './project.js';

/**
 * Extract error message from unknown error type
 */
function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface ReleaseOptions {
  type: ReleaseType;
  skipChangelog?: boolean;
  skipScripts?: boolean;
  dryRun?: boolean;
  push?: boolean;
}

export interface ReleaseResult {
  success: boolean;
  version?: string;
  tag?: string;
  error?: string;
}

/**
 * Validate release prerequisites and calculate new version
 * Does not execute the release - use interactiveRelease for that
 */
export async function executeRelease(options: ReleaseOptions): Promise<ReleaseResult> {
  const { type } = options;

  if (!(await isGitRepo())) {
    return { error: 'Not a git repository', success: false };
  }

  const project = await detectProject();
  if (!project) {
    return {
      error:
        'Could not detect project type. No package.json, pyproject.toml, Cargo.toml, etc. found.',
      success: false
    };
  }

  const newVersion = bumpVersion(project.version, type);
  const tagName = `v${newVersion}`;

  if (await tagExists(tagName)) {
    return {
      error: `Tag ${tagName} already exists. Delete it first with: git tag -d ${tagName}`,
      success: false
    };
  }

  return {
    success: true,
    tag: tagName,
    version: newVersion
  };
}

/**
 * Interactive release command
 */
export async function interactiveRelease(releaseType: ReleaseType): Promise<void> {
  // Pre-flight checks
  if (!(await isGitRepo())) {
    p.outro(theme.error('Not a git repository'));
    process.exit(1);
  }

  // Detect project
  const s = p.spinner();
  s.start('Detecting project...');

  const project = await detectProject();
  if (!project) {
    s.stop(theme.error('Project detection failed'));
    p.log.error(
      'Could not detect project type. Supported: package.json, pyproject.toml, Cargo.toml, mix.exs, go.mod'
    );
    process.exit(1);
  }

  s.stop(theme.success(`Detected ${project.type} project: ${project.name} v${project.version}`));

  // Calculate new version
  const newVersion = bumpVersion(project.version, releaseType);
  const tagName = `v${newVersion}`;

  // Check if tag exists
  if (await tagExists(tagName)) {
    p.log.error(`Tag ${tagName} already exists. Delete it first with: git tag -d ${tagName}`);
    process.exit(1);
  }

  // Get previous tag for changelog
  const prevTag = await getLatestTag();

  p.log.info(`${theme.info('Release:')} ${project.version} → ${theme.success(newVersion)}`);

  // Confirm release
  const confirmed = await p.confirm({
    message: `Create release ${tagName}?`
  });

  if (p.isCancel(confirmed) || !confirmed) {
    p.outro('Release cancelled');
    process.exit(0);
  }

  // Update version in project files BEFORE running build scripts
  // so binaries have the correct version embedded
  s.start('Updating version...');
  try {
    await updateProjectVersion(project, newVersion);
    s.stop(theme.success(`Updated ${project.metadataFiles.join(', ')} to v${newVersion}`));
  } catch (err) {
    s.stop(theme.error('Version update failed'));
    p.log.error(getErrorMessage(err));
    process.exit(1);
  }

  // Check for .aic config
  const aicConfig = await parseAicConfig();

  // Run release scripts if configured
  if (aicConfig?.release && aicConfig.release.length > 0) {
    const scriptSuccess = await executeSectionWithProgress('release', aicConfig, s);

    if (!scriptSuccess) {
      p.log.error('Release scripts failed');
      const continueAnyway = await p.confirm({
        message: 'Continue with release anyway?'
      });
      if (p.isCancel(continueAnyway) || !continueAnyway) {
        process.exit(1);
      }
    }
  }

  // Generate changelog
  s.start('Generating changelog...');

  try {
    // Check/initialize changelog
    const convention = await detectChangelogConvention();
    if (convention === 'none') {
      await initializeChangelog();
    } else if (convention === 'other') {
      s.stop(theme.warning('Non-standard changelog detected'));
      const migrate = await p.confirm({
        message: 'Migrate to Keep a Changelog format?'
      });
      if (p.isCancel(migrate)) {
        process.exit(0);
      }
      if (migrate) {
        await initializeChangelog();
      }
      s.start('Generating changelog...');
    }

    const changelogContent = await generateChangelog(newVersion, prevTag);
    const entry = formatChangelogEntry(newVersion, changelogContent);
    await writeChangelog(entry);

    s.stop(theme.success('Changelog generated'));

    // Show changelog preview
    p.log.message('');
    p.log.message(theme.info('─'.repeat(50)));
    p.log.message(entry.trim());
    p.log.message(theme.info('─'.repeat(50)));
    p.log.message('');
  } catch (err) {
    s.stop(theme.warning('Changelog generation failed'));
    p.log.warn(getErrorMessage(err));

    const continueWithout = await p.confirm({
      message: 'Continue without changelog?'
    });

    if (p.isCancel(continueWithout) || !continueWithout) {
      process.exit(1);
    }
  }

  // Stage and commit
  s.start('Creating release commit...');
  try {
    const filesToStage = ['CHANGELOG.md', ...project.metadataFiles];
    await stageFiles(filesToStage);
    await commit(`chore: release v${newVersion}`);
    s.stop(theme.success('Committed release'));
  } catch (err) {
    s.stop(theme.error('Commit failed'));
    p.log.error(getErrorMessage(err));
    process.exit(1);
  }

  // Create tag
  s.start(`Creating tag ${tagName}...`);
  try {
    await createTag(tagName, `Release ${newVersion}`);
    s.stop(theme.success(`Tagged ${tagName}`));
  } catch (err) {
    s.stop(theme.error('Tag creation failed'));
    p.log.error(getErrorMessage(err));
    process.exit(1);
  }

  // Offer to push
  const shouldPush = await p.confirm({
    message: 'Push release (with tags)?'
  });

  if (p.isCancel(shouldPush) || !shouldPush) {
    p.outro(theme.success(`Released ${tagName}! Run: git push --follow-tags`));
    process.exit(0);
  }

  s.start('Pushing...');
  try {
    await pushWithTags();
    s.stop(theme.success('Pushed to remote'));
  } catch (err) {
    s.stop(theme.error('Push failed'));
    p.log.error(getErrorMessage(err));
    p.outro(theme.warning(`Released ${tagName} locally. Push manually: git push --follow-tags`));
    process.exit(1);
  }

  // Run publish scripts if configured
  if (aicConfig?.publish && aicConfig.publish.length > 0) {
    const runPublish = await p.confirm({
      message: 'Run publish scripts?'
    });

    if (!p.isCancel(runPublish) && runPublish) {
      await executeSectionWithProgress('publish', aicConfig, s);
    }
  }

  p.outro(theme.success(`🚀 Released ${tagName}!`));
}

/**
 * Initialize release configuration for a project
 */
export async function initRelease(): Promise<void> {
  if (!(await isGitRepo())) {
    p.outro(theme.error('Not a git repository'));
    process.exit(1);
  }

  const project = await detectProject();
  const projectType = project?.type || 'default';

  // Check for existing .aic
  if (await hasAicConfig()) {
    const overwrite = await p.confirm({
      message: '.aic file already exists. Overwrite?'
    });
    if (p.isCancel(overwrite) || !overwrite) {
      p.outro('Cancelled');
      process.exit(0);
    }
  }

  // Check for existing changelog
  const changelogConvention = await detectChangelogConvention();

  if (changelogConvention === 'none') {
    await initializeChangelog();
    p.log.success('Created CHANGELOG.md');
  } else if (changelogConvention === 'other') {
    const migrate = await p.confirm({
      message: 'Found non-standard CHANGELOG. Migrate to Keep a Changelog format?'
    });
    if (!p.isCancel(migrate) && migrate) {
      // Backup and create new
      const existing = await Bun.file('CHANGELOG.md').text();
      await Bun.write('CHANGELOG.md.bak', existing);
      await initializeChangelog();
      p.log.success('Created CHANGELOG.md (old file backed up to CHANGELOG.md.bak)');
    }
  }

  // Create .aic config
  await initAicConfig(projectType);
  p.log.success(`Created .aic config for ${projectType} project`);

  p.outro(theme.success('Release configuration initialized! Edit .aic to customize.'));
}
