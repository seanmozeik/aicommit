import { confirm, intro, log, outro, spinner } from '@clack/prompts';
import { Effect, Option } from 'effect';
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
import { presetFlag } from './cli-flags';
import { commit, createTag, getLatestTag, isGitRepo, pushWithTags, stageFiles } from './git';
import { bumpVersion, detectProject, updateProjectVersion } from './project';
import { loadDefaultPreset } from './secrets';
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

const resolvePresetName = (preset: Option.Option<string>): Effect.Effect<string, unknown> =>
  Effect.gen(function* resolvePresetNameGen() {
    if (Option.isSome(preset)) {
      return preset.value;
    }
    return yield* Effect.tryPromise(() => loadDefaultPreset());
  });

const interactiveRelease = (
  releaseType: ReleaseType,
  preset: Option.Option<string>,
): Effect.Effect<void, unknown> =>
  Effect.gen(function* interactiveReleaseGen() {
    intro(theme.primary('🚀 Release'));

    const inRepo = yield* Effect.tryPromise(() => isGitRepo());
    if (!inRepo) {
      outro(theme.error('Not a git repository'));
      process.exit(1);
    }

    const project = yield* detectProject();
    if (!project) {
      outro(theme.error('Could not detect project type'));
      process.exit(1);
    }

    const latestTag = yield* Effect.tryPromise(() => getLatestTag());
    const presetName = yield* resolvePresetName(preset);
    const currentVersion = project.version;
    const newVersion = bumpVersion(currentVersion, releaseType);

    log.info(`Current version: ${currentVersion}`);
    log.info(`New version: ${newVersion}`);

    const shouldBump = yield* Effect.tryPromise(() =>
      confirm({ message: `Bump version from ${currentVersion} to ${newVersion}?` }),
    );

    if (shouldBump === false) {
      outro(theme.warning('Release cancelled'));
      process.exit(0);
    }

    const config = (yield* Effect.tryPromise(() => hasAicConfig()))
      ? yield* Effect.tryPromise(() => parseAicConfig())
      : null;

    // Update project version
    yield* updateProjectVersion(project, newVersion);
    log.success(`Updated ${project.type} version to ${newVersion}`);

    // Generate changelog
    if (!(yield* Effect.tryPromise(() => Bun.file('CHANGELOG.md').exists()))) {
      yield* Effect.tryPromise(() => initializeChangelog());
    }
    const changelogBody = yield* Effect.tryPromise({
      catch: (error) => {
        throw new Error(
          `Changelog generation failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      },
      try: () => generateChangelog(newVersion, latestTag, presetName),
    });
    const entry = formatChangelogEntry(newVersion, changelogBody);
    yield* Effect.tryPromise(() => writeChangelog(entry));
    log.success('Updated changelog');

    if (config?.release) {
      const s = spinner();
      const ok = yield* Effect.tryPromise(() => executeSectionWithProgress('release', config, s));
      if (!ok) {
        outro(theme.error('Release command failed'));
        process.exit(1);
      }
    }

    // Commit changes
    const releaseMetadataFiles = yield* Effect.tryPromise(() =>
      getReleaseMetadataFiles(project.metadataFiles),
    );
    yield* Effect.tryPromise(() => stageFiles(releaseMetadataFiles));
    yield* Effect.tryPromise(() => commit(`chore(release): ${newVersion}`));
    log.success('Committed version bump and changelog');

    // Create tag
    yield* Effect.tryPromise(() => createTag(newVersion));
    log.success(`Created tag ${newVersion}`);

    // Push to remote
    const shouldPush = yield* Effect.tryPromise(() => confirm({ message: 'Push to remote?' }));

    if (shouldPush === true) {
      yield* Effect.tryPromise(() => pushWithTags());
      log.success('Pushed to remote');
    }

    if (config?.publish) {
      const shouldPublish = yield* Effect.tryPromise(() =>
        confirm({ message: 'Run publish commands?' }),
      );
      if (shouldPublish === true) {
        const s = spinner();
        const ok = yield* Effect.tryPromise(() => executeSectionWithProgress('publish', config, s));
        if (!ok) {
          outro(theme.error('Publish command failed'));
          process.exit(1);
        }
      }
    }

    outro(theme.success(`Release ${newVersion} complete!`));
  }).pipe(
    Effect.onInterrupt(() => {
      outro(theme.warning('Release cancelled'));
      return Effect.void;
    }),
  );

const initRelease = Effect.gen(function* initReleaseGen() {
  intro(theme.primary('🔧 Release Configuration'));

  const inRepo = yield* Effect.tryPromise(() => isGitRepo());
  if (!inRepo) {
    outro(theme.error('Not a git repository'));
    process.exit(1);
  }

  if (yield* Effect.tryPromise(() => hasAicConfig())) {
    outro(theme.warning('.aic already exists'));
    process.exit(0);
  }

  yield* Effect.tryPromise(() => initAicConfig('.'));
  outro(theme.success('Release configuration initialized!'));
});

const releaseCommand = Command.make('release', {
  preset: presetFlag,
  releaseType: releaseTypeArg,
}).pipe(Command.withHandler(({ preset, releaseType }) => interactiveRelease(releaseType, preset)));

const releaseInitCommand = Command.make('release-init').pipe(
  Command.withHandler(() =>
    Effect.gen(function* releaseInitHandler() {
      yield* initRelease;
    }),
  ),
);

export { interactiveRelease, initRelease, releaseCommand, releaseInitCommand };
