/* oxlint-disable new-cap */
import { Effect, Option, Schema } from 'effect';

import type { ProjectInfo, ProjectType, ReleaseType } from './types';

interface MetadataHandler {
  readonly files: readonly string[];
  readonly detect: (content: string) => Effect.Effect<ProjectMetadata | null>;
  readonly updateVersion: (content: string, newVersion: string) => Effect.Effect<string, unknown>;
}

interface ProjectMetadata {
  readonly name: string;
  readonly version: string;
}

const JSON_INDENT = 2;
const BASE_10 = 10;
const VERSION_PART_PATCH = 2;

const packageJson = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  version: Schema.String,
});
const packageJsonFromString = Schema.fromJsonString(packageJson);
const jsonObjectFromString = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown));

const parsePackageJsonOption = Schema.decodeUnknownOption(packageJsonFromString);
const parseJsonObject = Schema.decodeUnknownEffect(jsonObjectFromString);

const matchProjectMetadata = (
  versionMatch: RegExpExecArray | null,
  name: string,
): ProjectMetadata | null =>
  versionMatch?.[1] === undefined ? null : { name, version: versionMatch[1] };

const succeedMetadata = (metadata: ProjectMetadata | null): Effect.Effect<ProjectMetadata | null> =>
  Effect.succeed(metadata);

const METADATA_HANDLERS: Record<ProjectType, MetadataHandler> = {
  elixir: {
    detect: (content) => {
      const versionMatch = /version:\s*["']([^"']+)["']/u.exec(content);
      const appMatch = /app:\s*:(\w+)/u.exec(content);
      return succeedMetadata(matchProjectMetadata(versionMatch, appMatch?.[1] ?? 'unknown'));
    },
    files: ['mix.exs'],
    updateVersion: (content, newVersion) =>
      Effect.succeed(content.replace(/(version:\s*["'])([^"']+)(["'])/u, `$1${newVersion}$3`)),
  },
  go: {
    detect: (content) => {
      const moduleMatch = /module\s+([^\s]+)/u.exec(content);
      const versionMatch = /(?:Version|VERSION)\s*=\s*["']([^"']+)["']/u.exec(content);
      if (moduleMatch?.[1] === undefined) {
        return succeedMetadata(null);
      }
      return succeedMetadata({
        name: moduleMatch[1].split('/').pop() ?? 'unknown',
        version: versionMatch?.[1] ?? '0.0.0',
      });
    },
    files: ['go.mod', 'version.go'],
    updateVersion: (content, newVersion) =>
      Effect.succeed(
        content.replace(/((?:Version|VERSION)\s*=\s*["'])([^"']+)(["'])/u, `$1${newVersion}$3`),
      ),
  },
  node: {
    detect: (content) => {
      const parsed = parsePackageJsonOption(content);
      return Effect.succeed(
        Option.match(parsed, {
          onNone: () => null,
          onSome: (pkg) => ({ name: pkg.name ?? 'unknown', version: pkg.version }),
        }),
      );
    },
    files: ['package.json'],
    updateVersion: (content, newVersion) =>
      Effect.gen(function* updateNodeVersion() {
        const pkg = yield* parseJsonObject(content);
        return `${JSON.stringify({ ...pkg, version: newVersion }, null, JSON_INDENT)}\n`;
      }),
  },
  python: {
    detect: (content) => {
      const projectMatch = /\[project\]\s*[\s\S]*?name\s*=\s*["']([^"']+)["']/u.exec(content);
      const versionMatch = /version\s*=\s*["']([^"']+)["']/u.exec(content);
      const projectMetadata = matchProjectMetadata(versionMatch, projectMatch?.[1] ?? 'unknown');
      if (projectMetadata !== null) {
        return succeedMetadata(projectMetadata);
      }

      const verVarMatch = /__version__\s*=\s*["']([^"']+)["']/u.exec(content);
      return succeedMetadata(matchProjectMetadata(verVarMatch, 'unknown'));
    },
    files: ['pyproject.toml', 'setup.py', '__version__.py'],
    updateVersion: (content, newVersion) => {
      if (content.includes('[project]') || content.includes('[tool.poetry]')) {
        return Effect.succeed(
          content.replace(/(version\s*=\s*["'])([^"']+)(["'])/u, `$1${newVersion}$3`),
        );
      }
      if (content.includes('__version__')) {
        return Effect.succeed(
          content.replace(/(__version__\s*=\s*["'])([^"']+)(["'])/u, `$1${newVersion}$3`),
        );
      }
      return Effect.succeed(content);
    },
  },
  rust: {
    detect: (content) => {
      const nameMatch = /\[package\][\s\S]*?name\s*=\s*["']([^"']+)["']/u.exec(content);
      const versionMatch = /\[package\][\s\S]*?version\s*=\s*["']([^"']+)["']/u.exec(content);
      return succeedMetadata(matchProjectMetadata(versionMatch, nameMatch?.[1] ?? 'unknown'));
    },
    files: ['Cargo.toml'],
    updateVersion: (content, newVersion) =>
      Effect.succeed(
        content.replace(
          /(\[package\][\s\S]*?)(version\s*=\s*["'])([^"']+)(["'])/u,
          `$1$2${newVersion}$4`,
        ),
      ),
  },
  unknown: {
    detect: () => Effect.succeed(null),
    files: [],
    updateVersion: (content) => Effect.succeed(content),
  },
};

const fileExists = (filename: string): Effect.Effect<boolean> =>
  Effect.tryPromise(() => Bun.file(filename).exists());

const readFile = (filename: string): Effect.Effect<string> =>
  Effect.tryPromise(() => Bun.file(filename).text());

const writeFile = (filename: string, content: string): Effect.Effect<void> =>
  Effect.tryPromise(async () => {
    await Bun.write(filename, content);
  });

export const detectProject = Effect.fn('detectProject')(function* detectProjectGen() {
  const projectTypes: ProjectType[] = ['node', 'python', 'rust', 'go', 'elixir'];

  for (const type of projectTypes) {
    const handler = METADATA_HANDLERS[type];
    for (const filename of handler.files) {
      const exists = yield* fileExists(filename);
      if (exists) {
        const content = yield* readFile(filename);
        const info = yield* handler.detect(content);
        if (info !== null) {
          return { metadataFiles: [filename], name: info.name, type, version: info.version };
        }
      }
    }
  }

  return null;
});

export const updateProjectVersion = Effect.fn('updateProjectVersion')(
  function* updateProjectVersionGen(project: ProjectInfo, newVersion: string) {
    const handler = METADATA_HANDLERS[project.type];

    yield* Effect.forEach(
      project.metadataFiles,
      (filename) =>
        Effect.gen(function* updateProjectVersionFile() {
          const exists = yield* fileExists(filename);
          if (exists) {
            const content = yield* readFile(filename);
            const updated = yield* handler.updateVersion(content, newVersion);
            yield* writeFile(filename, updated);
          }
        }),
      { discard: true },
    );
  },
);

export const bumpVersion = (currentVersion: string, releaseType: ReleaseType): string => {
  const parts = currentVersion.split('.');
  const major = Number.parseInt(parts[0] ?? '0', BASE_10);
  const minor = Number.parseInt(parts[1] ?? '0', BASE_10);
  const patch = Number.parseInt(parts[VERSION_PART_PATCH] ?? '0', BASE_10);

  switch (releaseType) {
    case 'major': {
      return `${major + 1}.0.0`;
    }
    case 'minor': {
      return `${major}.${minor + 1}.0`;
    }
    case 'patch': {
      return `${major}.${minor}.${patch + 1}`;
    }
    default: {
      return currentVersion;
    }
  }
};
