import { $ } from 'bun';
import type { ProjectInfo, ProjectType, ReleaseType } from '../types.js';

interface MetadataHandler {
  files: string[];
  detect: (content: string) => { name: string; version: string } | null;
  updateVersion: (content: string, newVersion: string) => string;
}

const METADATA_HANDLERS: Record<ProjectType, MetadataHandler> = {
  elixir: {
    detect: (content) => {
      const versionMatch = content.match(/version:\s*["']([^"']+)["']/);
      const appMatch = content.match(/app:\s*:(\w+)/);
      if (versionMatch) {
        return {
          name: appMatch?.[1] || 'unknown',
          version: versionMatch[1]
        };
      }
      return null;
    },
    files: ['mix.exs'],
    updateVersion: (content, newVersion) => {
      return content.replace(/(version:\s*["'])([^"']+)(["'])/, `$1${newVersion}$3`);
    }
  },
  go: {
    detect: (content) => {
      // go.mod module path
      const moduleMatch = content.match(/module\s+([^\s]+)/);
      // version.go with const Version = "x.y.z"
      const versionMatch = content.match(/(?:Version|VERSION)\s*=\s*["']([^"']+)["']/);
      if (moduleMatch) {
        // Go modules don't have version in go.mod, check for version.go
        return {
          name: moduleMatch[1].split('/').pop() || 'unknown',
          version: versionMatch?.[1] || '0.0.0'
        };
      }
      return null;
    },
    files: ['go.mod', 'version.go'],
    updateVersion: (content, newVersion) => {
      // Update version.go style constants
      return content.replace(/((?:Version|VERSION)\s*=\s*["'])([^"']+)(["'])/, `$1${newVersion}$3`);
    }
  },
  node: {
    detect: (content) => {
      try {
        const pkg = JSON.parse(content);
        if (pkg.version) {
          return { name: pkg.name || 'unknown', version: pkg.version };
        }
      } catch {}
      return null;
    },
    files: ['package.json'],
    updateVersion: (content, newVersion) => {
      const pkg = JSON.parse(content);
      pkg.version = newVersion;
      return `${JSON.stringify(pkg, null, 2)}\n`;
    }
  },
  python: {
    detect: (content) => {
      // pyproject.toml with [project] section
      const projectMatch = content.match(/\[project\]\s*[\s\S]*?name\s*=\s*["']([^"']+)["']/);
      const versionMatch = content.match(/version\s*=\s*["']([^"']+)["']/);
      if (versionMatch) {
        return {
          name: projectMatch?.[1] || 'unknown',
          version: versionMatch[1]
        };
      }
      // __version__.py style
      const verVarMatch = content.match(/__version__\s*=\s*["']([^"']+)["']/);
      if (verVarMatch) {
        return { name: 'unknown', version: verVarMatch[1] };
      }
      return null;
    },
    files: ['pyproject.toml', 'setup.py', '__version__.py'],
    updateVersion: (content, newVersion) => {
      // Handle pyproject.toml version = "x.y.z"
      if (content.includes('[project]') || content.includes('[tool.poetry]')) {
        return content.replace(/(version\s*=\s*["'])([^"']+)(["'])/, `$1${newVersion}$3`);
      }
      // Handle __version__ = "x.y.z"
      if (content.includes('__version__')) {
        return content.replace(/(__version__\s*=\s*["'])([^"']+)(["'])/, `$1${newVersion}$3`);
      }
      return content;
    }
  },
  rust: {
    detect: (content) => {
      const nameMatch = content.match(/\[package\][\s\S]*?name\s*=\s*["']([^"']+)["']/);
      const versionMatch = content.match(/\[package\][\s\S]*?version\s*=\s*["']([^"']+)["']/);
      if (versionMatch) {
        return {
          name: nameMatch?.[1] || 'unknown',
          version: versionMatch[1]
        };
      }
      return null;
    },
    files: ['Cargo.toml'],
    updateVersion: (content, newVersion) => {
      // Only update version in [package] section
      const packageSection = content.match(
        /(\[package\][\s\S]*?)(version\s*=\s*["'])([^"']+)(["'])/
      );
      if (packageSection) {
        return content.replace(
          /(\[package\][\s\S]*?)(version\s*=\s*["'])([^"']+)(["'])/,
          `$1$2${newVersion}$4`
        );
      }
      return content;
    }
  },
  unknown: {
    detect: () => null,
    files: [],
    updateVersion: (content) => content
  }
};

/**
 * Detect project type and info by checking for metadata files
 */
export async function detectProject(): Promise<ProjectInfo | null> {
  const projectTypes: ProjectType[] = ['node', 'python', 'rust', 'go', 'elixir'];

  for (const type of projectTypes) {
    const handler = METADATA_HANDLERS[type];
    for (const filename of handler.files) {
      const file = Bun.file(filename);
      if (await file.exists()) {
        const content = await file.text();
        const info = handler.detect(content);
        if (info) {
          return {
            metadataFiles: [filename],
            name: info.name,
            type,
            version: info.version
          };
        }
      }
    }
  }

  return null;
}

/**
 * Calculate new version based on release type
 */
export function bumpVersion(currentVersion: string, releaseType: ReleaseType): string {
  const parts = currentVersion.split('.');
  const major = parseInt(parts[0] || '0', 10);
  const minor = parseInt(parts[1] || '0', 10);
  const patch = parseInt(parts[2] || '0', 10);

  switch (releaseType) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
  }
}

/**
 * Update version in all project metadata files
 */
export async function updateProjectVersion(
  project: ProjectInfo,
  newVersion: string
): Promise<void> {
  const handler = METADATA_HANDLERS[project.type];

  for (const filename of project.metadataFiles) {
    const file = Bun.file(filename);
    if (await file.exists()) {
      const content = await file.text();
      const updated = handler.updateVersion(content, newVersion);
      await Bun.write(filename, updated);
    }
  }
}

/**
 * Get the latest git tag for this project
 */
export async function getLatestTag(): Promise<string | null> {
  try {
    const output = await $`git describe --tags --abbrev=0`.text();
    return output.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Check if a tag already exists
 */
export async function tagExists(tag: string): Promise<boolean> {
  try {
    const output = await $`git tag -l ${tag}`.text();
    return output.trim().length > 0;
  } catch {
    return false;
  }
}
