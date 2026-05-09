import type { ProjectInfo, ProjectType, ReleaseType } from './types';

interface MetadataHandler {
  readonly files: readonly string[];
  readonly detect: (content: string) => { readonly name: string; readonly version: string } | null;
  readonly updateVersion: (content: string, newVersion: string) => string;
}

const JSON_INDENT = 2;
const BASE_10 = 10;
const VERSION_PART_PATCH = 2;

const METADATA_HANDLERS: Record<ProjectType, MetadataHandler> = {
  elixir: {
    detect: (content) => {
      const versionMatch = /version:\s*["']([^"']+)["']/u.exec(content);
      const appMatch = /app:\s*:(\w+)/u.exec(content);
      if (versionMatch && versionMatch[1]) {
        return { name: appMatch?.[1] ?? 'unknown', version: versionMatch[1] };
      }
      return null;
    },
    files: ['mix.exs'],
    updateVersion: (content, newVersion) => {
      return content.replace(/(version:\s*["'])([^"']+)(["'])/u, `$1${newVersion}$3`);
    },
  },
  go: {
    detect: (content) => {
      const moduleMatch = /module\s+([^\s]+)/u.exec(content);
      const versionMatch = /(?:Version|VERSION)\s*=\s*["']([^"']+)["']/u.exec(content);
      if (moduleMatch && moduleMatch[1]) {
        return {
          name: moduleMatch[1].split('/').pop() ?? 'unknown',
          version: versionMatch?.[1] ?? '0.0.0',
        };
      }
      return null;
    },
    files: ['go.mod', 'version.go'],
    updateVersion: (content, newVersion) => {
      return content.replace(
        /((?:Version|VERSION)\s*=\s*["'])([^"']+)(["'])/u,
        `$1${newVersion}$3`,
      );
    },
  },
  node: {
    detect: (content) => {
      try {
        const pkg = JSON.parse(content);
        if (pkg.version && typeof pkg.version === 'string') {
          return { name: pkg.name ?? 'unknown', version: pkg.version };
        }
      } catch {
        // Ignore JSON parse errors
      }
      return null;
    },
    files: ['package.json'],
    updateVersion: (content, newVersion) => {
      const pkg = JSON.parse(content) as { version: string; name?: string };
      pkg.version = newVersion;
      return `${JSON.stringify(pkg, null, JSON_INDENT)}\n`;
    },
  },
  python: {
    detect: (content) => {
      const projectMatch = /\[project\]\s*[\s\S]*?name\s*=\s*["']([^"']+)["']/u.exec(content);
      const versionMatch = /version\s*=\s*["']([^"']+)["']/u.exec(content);
      if (versionMatch && versionMatch[1]) {
        return { name: projectMatch?.[1] ?? 'unknown', version: versionMatch[1] };
      }
      const verVarMatch = /__version__\s*=\s*["']([^"']+)["']/u.exec(content);
      if (verVarMatch && verVarMatch[1]) {
        return { name: 'unknown', version: verVarMatch[1] };
      }
      return null;
    },
    files: ['pyproject.toml', 'setup.py', '__version__.py'],
    updateVersion: (content, newVersion) => {
      if (content.includes('[project]') || content.includes('[tool.poetry]')) {
        return content.replace(/(version\s*=\s*["'])([^"']+)(["'])/u, `$1${newVersion}$3`);
      }
      if (content.includes('__version__')) {
        return content.replace(/(__version__\s*=\s*["'])([^"']+)(["'])/u, `$1${newVersion}$3`);
      }
      return content;
    },
  },
  rust: {
    detect: (content) => {
      const nameMatch = /\[package\][\s\S]*?name\s*=\s*["']([^"']+)["']/u.exec(content);
      const versionMatch = /\[package\][\s\S]*?version\s*=\s*["']([^"']+)["']/u.exec(content);
      if (versionMatch && versionMatch[1]) {
        return { name: nameMatch?.[1] ?? 'unknown', version: versionMatch[1] };
      }
      return null;
    },
    files: ['Cargo.toml'],
    updateVersion: (content, newVersion) => {
      const packageSection = /(\[package\][\s\S]*?)(version\s*=\s*["'])([^"']+)(["'])/u.exec(
        content,
      );
      if (packageSection) {
        return content.replace(
          /(\[package\][\s\S]*?)(version\s*=\s*["'])([^"']+)(["'])/u,
          `$1$2${newVersion}$4`,
        );
      }
      return content;
    },
  },
  unknown: { detect: () => null, files: [], updateVersion: (content) => content },
};

export const detectProject = async (): Promise<ProjectInfo | null> => {
  const projectTypes: ProjectType[] = ['node', 'python', 'rust', 'go', 'elixir'];

  for (const type of projectTypes) {
    const handler = METADATA_HANDLERS[type];
    for (const filename of handler.files) {
      const file = Bun.file(filename);
      if (await file.exists()) {
        const content = await file.text();
        const info = handler.detect(content);
        if (info) {
          return { metadataFiles: [filename], name: info.name, type, version: info.version };
        }
      }
    }
  }

  return null;
};

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

export const updateProjectVersion = async (
  project: ProjectInfo,
  newVersion: string,
): Promise<void> => {
  const handler = METADATA_HANDLERS[project.type];

  for (const filename of project.metadataFiles) {
    const file = Bun.file(filename);
    if (await file.exists()) {
      const content = await file.text();
      const updated = handler.updateVersion(content, newVersion);
      await Bun.write(filename, updated);
    }
  }
};

export const getLatestTag = async (): Promise<string | null> => {
  try {
    const proc = Bun.spawn(['git', 'describe', '--tags', '--abbrev=0'], {
      stderr: 'pipe',
      stdout: 'pipe',
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      return null;
    }
    const output = await new Response(proc.stdout).text();
    return output.trim() || null;
  } catch {
    return null;
  }
};

export const tagExists = async (tag: string): Promise<boolean> => {
  try {
    const proc = Bun.spawn(['git', 'tag', '-l', tag], { stderr: 'pipe', stdout: 'pipe' });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      return false;
    }
    const output = await new Response(proc.stdout).text();
    return output.trim().length > 0;
  } catch {
    return false;
  }
};
