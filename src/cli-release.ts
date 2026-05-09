/* oxlint-disable import/no-namespace */
import * as p from '@clack/prompts';
import { Effect } from 'effect';
import { Argument, Command } from 'effect/unstable/cli';

import {
  executeSectionWithProgress,
  hasAicConfig,
  initAicConfig,
  parseAicConfig,
} from './aic-script';
import {
  formatChangelogEntry,
  generateChangelog,
  initializeChangelog,
  writeChangelog,
} from './changelog';
import { commit, createTag, getLatestTag, isGitRepo, pushWithTags, stageFiles } from './git';
import { bumpVersion, detectProject, updateProjectVersion } from './project';
import type { ReleaseType } from './types';
import { theme } from './ui/theme';

const releaseTypeArg = Argument.choice('type', ['patch', 'minor', 'major'] as const).pipe(
  Argument.withDefault('patch' as const),
  Argument.withDescription('Version bump type'),
);

const getReleaseMetadataFiles = async (projectFiles: readonly string[]): Promise<string[]> => {
  const files = new Set([...projectFiles, 'CHANGELOG.md']);
  if (await Bun.file('Formula/aic.rb').exists()) {
    files.add('Formula/aic.rb');
  }
  return [...files];
};

const interactiveRelease = async (releaseType: ReleaseType): Promise<void> => {
  p.intro(theme.primary('🚀 Release'));

  const inRepo = await isGitRepo();
  if (!inRepo) {
    p.outro(theme.error('Not a git repository'));
    process.exit(1);
  }

  const project = await detectProject();
  if (!project) {
    p.outro(theme.error('Could not detect project type'));
    process.exit(1);
  }

  const latestTag = await getLatestTag();
  const currentVersion = project.version;
  const newVersion = bumpVersion(currentVersion, releaseType);

  p.log.info(`Current version: ${currentVersion}`);
  p.log.info(`New version: ${newVersion}`);

  const confirm = await p.confirm({
    message: `Bump version from ${currentVersion} to ${newVersion}?`,
  });

  if (confirm === false) {
    p.outro(theme.warning('Release cancelled'));
    process.exit(0);
  }

  const config = (await hasAicConfig()) ? await parseAicConfig() : null;

  // Update project version
  await updateProjectVersion(project, newVersion);
  p.log.success(`Updated ${project.type} version to ${newVersion}`);

  // Generate changelog
  if (!(await Bun.file('CHANGELOG.md').exists())) {
    await initializeChangelog();
  }
  const changelogBody = await generateChangelog(newVersion, latestTag);
  const entry = formatChangelogEntry(newVersion, changelogBody);
  await writeChangelog(entry);
  p.log.success('Updated changelog');

  if (config?.release) {
    const s = p.spinner();
    const ok = await executeSectionWithProgress('release', config, s);
    if (!ok) {
      p.outro(theme.error('Release command failed'));
      process.exit(1);
    }
  }

  // Commit changes
  await stageFiles(await getReleaseMetadataFiles(project.metadataFiles));
  await commit(`chore(release): ${newVersion}`);
  p.log.success('Committed version bump and changelog');

  // Create tag
  await createTag(newVersion);
  p.log.success(`Created tag ${newVersion}`);

  // Push to remote
  const shouldPush = await p.confirm({ message: 'Push to remote?' });

  if (shouldPush === true) {
    await pushWithTags();
    p.log.success('Pushed to remote');
  }

  if (config?.publish) {
    const shouldPublish = await p.confirm({ message: 'Run publish commands?' });
    if (shouldPublish === true) {
      const s = p.spinner();
      const ok = await executeSectionWithProgress('publish', config, s);
      if (!ok) {
        p.outro(theme.error('Publish command failed'));
        process.exit(1);
      }
    }
  }

  p.outro(theme.success(`Release ${newVersion} complete!`));
};

const initRelease = async (): Promise<void> => {
  p.intro(theme.primary('🔧 Release Configuration'));

  const inRepo = await isGitRepo();
  if (!inRepo) {
    p.outro(theme.error('Not a git repository'));
    process.exit(1);
  }

  if (await hasAicConfig()) {
    p.outro(theme.warning('.aic already exists'));
    process.exit(0);
  }

  await initAicConfig('.');
  p.outro(theme.success('Release configuration initialized!'));
};

const releaseCommand = Command.make('release', { releaseType: releaseTypeArg }).pipe(
  Command.withHandler(({ releaseType }) =>
    Effect.gen(function* releaseHandler() {
      yield* Effect.tryPromise(() => interactiveRelease(releaseType));
    }),
  ),
);

const releaseInitCommand = Command.make('release-init').pipe(
  Command.withHandler(() =>
    Effect.gen(function* releaseInitHandler() {
      yield* Effect.tryPromise(() => initRelease());
    }),
  ),
);

export { interactiveRelease, initRelease, releaseCommand, releaseInitCommand };
