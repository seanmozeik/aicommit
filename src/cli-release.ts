/* oxlint-disable import/no-namespace */
import * as p from '@clack/prompts';
import { Effect } from 'effect';
import { Command } from 'effect/unstable/cli';

import { hasAicConfig, initAicConfig, parseAicConfig } from './aic-script';
import { formatChangelogEntry, initializeChangelog, writeChangelog } from './changelog';
import { commit, createTag, getLatestTag, isGitRepo, pushWithTags, stageFiles } from './git';
import { bumpVersion, detectProject, updateProjectVersion } from './project';
import type { ReleaseType } from './types';
import { theme } from './ui/theme';

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

  await getLatestTag();
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

  // Update project version
  await updateProjectVersion(project, newVersion);
  p.log.success(`Updated ${project.type} version to ${newVersion}`);

  // Generate changelog
  if (await hasAicConfig()) {
    const config = await parseAicConfig();
    if (config?.release) {
      await initializeChangelog();
      const entry = formatChangelogEntry(newVersion, '');
      await writeChangelog(entry);
      p.log.success('Updated changelog');
    }
  }

  // Commit changes
  await stageFiles(['CHANGELOG.md']);
  await commit(`chore(release): ${newVersion}`);
  p.log.success('Committed version bump and changelog');

  // Create tag
  await createTag(newVersion);
  p.log.success(`Created tag ${newVersion}`);

  // Push to remote
  const shouldPush = await p.confirm({ message: 'Push to remote?' });

  if (shouldPush) {
    await pushWithTags();
    p.log.success('Pushed to remote');
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

const releaseCommand = Command.make('release').pipe(
  Command.withHandler(() =>
    Effect.gen(function* releaseHandler() {
      yield* Effect.tryPromise(() => interactiveRelease('patch'));
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
