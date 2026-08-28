import { Effect, Option, Schema } from 'effect';

import type { ProjectInfo, ProjectType, ReleaseType } from '../domain/types';

interface MetadataHandler {
  readonly detect: (content: string) => Effect.Effect<ProjectMetadata | null>;
  readonly files: readonly string[];
  readonly updateVersion: (content: string, newVersion: string) => Effect.Effect<string>;
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

const matchProjectMetadata = (version: string | undefined, name: string): ProjectMetadata | null =>
  version === undefined ? null : { name, version };

const succeedMetadata = (metadata: ProjectMetadata | null): Effect.Effect<ProjectMetadata | null> =>
  Effect.succeed(metadata);

const parseGoModule = (
  content: string,
): { readonly name: string; readonly version?: string } | null => {
  const moduleMatch = /module\s+(?<module>[^\s]+)/u.exec(content);
  const moduleName = moduleMatch?.groups?.['module'];
  if (moduleName === undefined) {
    return null;
  }
  const version = /(?:Version|VERSION)\s*=\s*["'](?<version>[^"']+)["']/u.exec(content)?.groups?.[
    'version'
  ];
  return version === undefined
    ? { name: moduleName.split('/').pop() ?? 'unknown' }
    : { name: moduleName.split('/').pop() ?? 'unknown', version };
};

const parseGoVersion = (content: string): string | undefined =>
  /(?:Version|VERSION)\s*=\s*["'](?<version>[^"']+)["']/u.exec(content)?.groups?.['version'];

const METADATA_HANDLERS: Record<ProjectType, MetadataHandler> = {
  elixir: {
    detect: (content) => {
      const versionMatch = /version:\s*["'](?<version>[^"']+)["']/u.exec(content);
      const appMatch = /app:\s*:(?<name>\w+)/u.exec(content);
      return succeedMetadata(
        matchProjectMetadata(
          versionMatch?.groups?.['version'],
          appMatch?.groups?.['name'] ?? 'unknown',
        ),
      );
    },
    files: ['mix.exs'],
    updateVersion: (content, newVersion) =>
      Effect.succeed(
        content.replace(
          /(?<prefix>version:\s*["'])(?<version>[^"']+)(?<suffix>["'])/u,
          `$<prefix>${newVersion}$<suffix>`,
        ),
      ),
  },
  go: {
    detect: (content) => {
      const metadata = parseGoModule(content);
      return succeedMetadata(
        metadata === null ? null : { name: metadata.name, version: metadata.version ?? '0.0.0' },
      );
    },
    files: ['go.mod', 'version.go'],
    updateVersion: (content, newVersion) =>
      Effect.succeed(
        content.replace(
          /(?<prefix>(?:Version|VERSION)\s*=\s*["'])(?<version>[^"']+)(?<suffix>["'])/u,
          `$<prefix>${newVersion}$<suffix>`,
        ),
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
        const pkg = yield* parseJsonObject(content).pipe(Effect.orDie);
        return `${JSON.stringify({ ...pkg, version: newVersion }, null, JSON_INDENT)}\n`;
      }),
  },
  python: {
    detect: (content) => {
      const projectMatch = /\[project\]\s*[\s\S]*?name\s*=\s*["'](?<name>[^"']+)["']/u.exec(
        content,
      );
      const versionMatch = /version\s*=\s*["'](?<version>[^"']+)["']/u.exec(content);
      const projectMetadata = matchProjectMetadata(
        versionMatch?.groups?.['version'],
        projectMatch?.groups?.['name'] ?? 'unknown',
      );
      if (projectMetadata !== null) {
        return succeedMetadata(projectMetadata);
      }

      const verVarMatch = /__version__\s*=\s*["'](?<version>[^"']+)["']/u.exec(content);
      return succeedMetadata(matchProjectMetadata(verVarMatch?.groups?.['version'], 'unknown'));
    },
    files: ['pyproject.toml', 'setup.py', '__version__.py'],
    updateVersion: (content, newVersion) => {
      if (content.includes('[project]') || content.includes('[tool.poetry]')) {
        return Effect.succeed(
          content.replace(
            /(?<prefix>version\s*=\s*["'])(?<version>[^"']+)(?<suffix>["'])/u,
            `$<prefix>${newVersion}$<suffix>`,
          ),
        );
      }
      if (content.includes('__version__')) {
        return Effect.succeed(
          content.replace(
            /(?<prefix>__version__\s*=\s*["'])(?<version>[^"']+)(?<suffix>["'])/u,
            `$<prefix>${newVersion}$<suffix>`,
          ),
        );
      }
      return Effect.succeed(content);
    },
  },
  rust: {
    detect: (content) => {
      const pkgName = /\[package\][\s\S]*?\bname\s*=\s*["'](?<name>[^"']+)["']/u.exec(content);
      const pkgVersion = /\[package\][\s\S]*?\bversion\s*=\s*["'](?<version>[^"']+)["']/u.exec(
        content,
      );
      const wsName = /\[workspace\.package\][\s\S]*?\bname\s*=\s*["'](?<name>[^"']+)["']/u.exec(
        content,
      );
      const wsVersion =
        /\[workspace\.package\][\s\S]*?\bversion\s*=\s*["'](?<version>[^"']+)["']/u.exec(content);
      const version = pkgVersion?.groups?.['version'] ?? wsVersion?.groups?.['version'];
      const name = pkgName?.groups?.['name'] ?? wsName?.groups?.['name'] ?? 'unknown';
      return succeedMetadata(matchProjectMetadata(version, name));
    },
    files: ['Cargo.toml'],
    updateVersion: (content, newVersion) => {
      const pkgPattern =
        /(?<packagePrefix>\[package\][\s\S]*?)(?<versionPrefix>version\s*=\s*["'])(?<version>[^"']+)(?<suffix>["'])/u;
      if (pkgPattern.test(content)) {
        return Effect.succeed(
          content.replace(pkgPattern, `$<packagePrefix>$<versionPrefix>${newVersion}$<suffix>`),
        );
      }
      return Effect.succeed(
        content.replace(
          /(?<workspacePrefix>\[workspace\.package\][\s\S]*?)(?<versionPrefix>version\s*=\s*["'])(?<version>[^"']+)(?<suffix>["'])/u,
          `$<workspacePrefix>$<versionPrefix>${newVersion}$<suffix>`,
        ),
      );
    },
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

const detectGoProject = Effect.gen(function* detectGoProjectGen() {
  if (!(yield* fileExists('go.mod'))) {
    return null;
  }
  const moduleMetadata = parseGoModule(yield* readFile('go.mod'));
  if (moduleMetadata === null) {
    return null;
  }
  if (moduleMetadata.version !== undefined) {
    return {
      metadataFiles: ['go.mod'],
      name: moduleMetadata.name,
      type: 'go' as const,
      version: moduleMetadata.version,
    };
  }
  if (yield* fileExists('version.go')) {
    const version = parseGoVersion(yield* readFile('version.go'));
    if (version !== undefined) {
      return {
        metadataFiles: ['version.go'],
        name: moduleMetadata.name,
        type: 'go' as const,
        version,
      };
    }
  }
  return {
    metadataFiles: ['go.mod'],
    name: moduleMetadata.name,
    type: 'go' as const,
    version: '0.0.0',
  };
});

const detectMetadataProject = Effect.fn('detectMetadataProject')(function* detectMetadataProjectGen(
  type: Exclude<ProjectType, 'go' | 'unknown'>,
) {
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
  return null;
});

export const detectProject = Effect.fn('detectProject')(function* detectProjectGen() {
  const projectTypes: ProjectType[] = ['node', 'python', 'rust', 'go', 'elixir'];

  for (const type of projectTypes) {
    if (type === 'go') {
      const goProject = yield* detectGoProject;
      if (goProject !== null) {
        return goProject;
      }
    } else if (type !== 'unknown') {
      const project = yield* detectMetadataProject(type);
      if (project !== null) {
        return project;
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
