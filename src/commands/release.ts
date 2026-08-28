import { confirm, intro, isCancel, log, outro, spinner } from '@clack/prompts';
import { Effect, Option } from 'effect';
import { Argument, Command } from 'effect/unstable/cli';

import {
  executeSectionWithProgress,
  hasAicConfig,
  initAicConfig,
  parseAicConfig,
} from '../aic-script';
import { loadDefaultPreset } from '../config/secrets';
import type { AicConfig, ProjectInfo, ReleaseType } from '../domain/types';
import { ReleaseError } from '../errors/release-error';
import {
  commit,
  createTag,
  getLatestTag,
  isClean,
  isGitRepo,
  pushWithTags,
  stageFiles,
} from '../git';
import {
  formatChangelogEntry,
  generateChangelog,
  initializeChangelog,
  writeChangelog,
} from '../release/changelog';
import { bumpVersion, detectProject, updateProjectVersion } from '../release/project';
import { frappeColors, theme } from '../ui/theme';
import { presetFlag } from './flags';

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

interface ReleaseContext {
  readonly latestTag: string | null;
  readonly newVersion: string;
  readonly presetName: string;
  readonly project: ProjectInfo;
}

const releaseError = (message: string, cause?: unknown): ReleaseError =>
  cause === undefined ? new ReleaseError({ message }) : new ReleaseError({ cause, message });

const releasePromise = <A>(
  message: string,
  operation: () => Promise<A>,
): Effect.Effect<A, ReleaseError> =>
  Effect.tryPromise({ catch: (cause) => releaseError(message, cause), try: operation });

export const resolveReleasePromptValue = <A>(
  value: A | symbol,
  cancelled: (candidate: A | symbol) => candidate is symbol = isCancel,
): Effect.Effect<A> => (cancelled(value) ? Effect.interrupt : Effect.succeed(value));

const confirmRelease = (message: string): Effect.Effect<boolean, ReleaseError> =>
  releasePromise('Release confirmation failed', () => confirm({ message })).pipe(
    Effect.flatMap(resolveReleasePromptValue),
  );

export const requireCleanRepository = (
  check: () => Promise<boolean> = isClean,
): Effect.Effect<void, ReleaseError> =>
  releasePromise('Could not inspect repository status', check).pipe(
    Effect.flatMap((clean) =>
      clean
        ? Effect.void
        : Effect.fail(
            releaseError(
              'Release requires a clean repository; commit, stash, or remove staged, unstaged, and untracked changes first.',
            ),
          ),
    ),
  );

const requireReleasePreflight = Effect.gen(function* requireReleasePreflightGen() {
  const inRepo = yield* releasePromise('Could not inspect the git repository', isGitRepo);
  if (!inRepo) {
    return yield* releaseError('Not a git repository');
  }
  return yield* requireCleanRepository();
});

const resolvePresetName = (preset: Option.Option<string>): Effect.Effect<string, ReleaseError> =>
  Option.isSome(preset)
    ? Effect.succeed(preset.value)
    : releasePromise('Could not load the default preset', loadDefaultPreset);

const loadReleaseContext = (
  releaseType: ReleaseType,
  preset: Option.Option<string>,
): Effect.Effect<ReleaseContext, ReleaseError> =>
  Effect.gen(function* loadReleaseContextGen() {
    const project = yield* detectProject().pipe(
      Effect.mapError((cause) => releaseError('Could not detect project type', cause)),
    );
    if (project === null) {
      return yield* releaseError('Could not detect project type');
    }
    const latestTag = yield* releasePromise(
      'Could not inspect existing release tags',
      getLatestTag,
    );
    const presetName = yield* resolvePresetName(preset);
    return {
      latestTag,
      newVersion: bumpVersion(project.version, releaseType),
      presetName,
      project,
    };
  });

const confirmVersionBump = (context: ReleaseContext): Effect.Effect<void, ReleaseError> =>
  Effect.gen(function* confirmVersionBumpGen() {
    log.info(`Current version: ${context.project.version}`);
    log.info(`New version: ${context.newVersion}`);
    const confirmed = yield* confirmRelease(
      `Bump version from ${context.project.version} to ${context.newVersion}?`,
    );
    if (!confirmed) {
      return yield* Effect.interrupt;
    }
    return yield* Effect.void;
  });

const loadReleaseConfig = (): Effect.Effect<AicConfig | null, ReleaseError> =>
  releasePromise('Could not inspect .aic release configuration', hasAicConfig).pipe(
    Effect.flatMap((configured) =>
      configured
        ? releasePromise('Could not read .aic release configuration', parseAicConfig)
        : Effect.succeed(null),
    ),
  );

const updateChangelog = (context: ReleaseContext): Effect.Effect<void, ReleaseError> =>
  Effect.gen(function* updateChangelogGen() {
    const changelogExists = yield* releasePromise('Could not inspect CHANGELOG.md', () =>
      Bun.file('CHANGELOG.md').exists(),
    );
    if (!changelogExists) {
      yield* releasePromise('Could not initialize CHANGELOG.md', initializeChangelog);
    }
    const progress = spinner();
    progress.start(
      frappeColors.subtext1(`Generating changelog with preset "${context.presetName}"...`),
    );
    const body = yield* releasePromise('Changelog generation failed', () =>
      generateChangelog(context.newVersion, context.latestTag, context.presetName),
    ).pipe(
      Effect.tapError(() =>
        Effect.sync(() => {
          progress.stop(theme.error('Failed'));
        }),
      ),
    );
    progress.stop(frappeColors.subtext1('Done'));
    const entry = formatChangelogEntry(context.newVersion, body);
    yield* releasePromise('Could not write CHANGELOG.md', () => writeChangelog(entry));
    log.success('Updated changelog');
  });

const runConfiguredSection = (
  section: 'publish' | 'release',
  config: AicConfig,
): Effect.Effect<void, ReleaseError> =>
  Effect.gen(function* runConfiguredSectionGen() {
    const progress = spinner();
    const completed = yield* releasePromise(`Could not run ${section} commands`, () =>
      executeSectionWithProgress(section, config, progress),
    );
    if (!completed) {
      return yield* releaseError(`${section === 'release' ? 'Release' : 'Publish'} command failed`);
    }
    return yield* Effect.void;
  });

const updateReleaseFiles = (
  context: ReleaseContext,
  config: AicConfig | null,
): Effect.Effect<void, ReleaseError> =>
  Effect.gen(function* updateReleaseFilesGen() {
    yield* updateProjectVersion(context.project, context.newVersion).pipe(
      Effect.mapError((cause) => releaseError('Could not update the project version', cause)),
    );
    log.success(`Updated ${context.project.type} version to ${context.newVersion}`);
    yield* updateChangelog(context);
    if (config?.release !== undefined) {
      yield* runConfiguredSection('release', config);
    }
  });

const commitAndTagRelease = (context: ReleaseContext): Effect.Effect<void, ReleaseError> =>
  Effect.gen(function* commitAndTagReleaseGen() {
    const metadataFiles = yield* releasePromise('Could not identify release metadata', () =>
      getReleaseMetadataFiles(context.project.metadataFiles),
    );
    yield* releasePromise('Could not stage release metadata', () => stageFiles(metadataFiles));
    yield* releasePromise('Could not commit release metadata', () =>
      commit(`chore(release): ${context.newVersion}`),
    );
    log.success('Committed version bump and changelog');
    yield* releasePromise('Could not create the release tag', () => createTag(context.newVersion));
    log.success(`Created tag ${context.newVersion}`);
  });

const runOptionalRemoteActions = (config: AicConfig | null): Effect.Effect<void, ReleaseError> =>
  Effect.gen(function* runOptionalRemoteActionsGen() {
    const shouldPush = yield* confirmRelease('Push to remote?');
    if (shouldPush) {
      yield* releasePromise('Could not push the release', pushWithTags);
      log.success('Pushed to remote');
    }
    if (config?.publish !== undefined) {
      const shouldPublish = yield* confirmRelease('Run publish commands?');
      if (shouldPublish) {
        yield* runConfiguredSection('publish', config);
      }
    }
  });

const interactiveRelease = (
  releaseType: ReleaseType,
  preset: Option.Option<string>,
): Effect.Effect<void, unknown> =>
  Effect.gen(function* interactiveReleaseGen() {
    yield* requireReleasePreflight;
    intro(theme.primary('🚀 Release'));
    const context = yield* loadReleaseContext(releaseType, preset);
    yield* confirmVersionBump(context);
    const config = yield* loadReleaseConfig();
    yield* updateReleaseFiles(context, config);
    yield* commitAndTagRelease(context);
    yield* runOptionalRemoteActions(config);
    outro(theme.success(`Release ${context.newVersion} complete!`));
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
  Command.withHandler(() => initRelease),
);

export { interactiveRelease, initRelease, releaseCommand, releaseInitCommand };
