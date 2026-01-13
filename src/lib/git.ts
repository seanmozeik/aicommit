import { $ } from 'bun';

/**
 * Get the root directory of the git repository
 */
export async function getGitRoot(): Promise<string | null> {
  try {
    return (await $`git rev-parse --show-toplevel`.text()).trim();
  } catch {
    return null;
  }
}

/**
 * Change to git repository root directory
 * Returns true if successful, false if not in a git repo
 */
export async function cdToGitRoot(): Promise<boolean> {
  const root = await getGitRoot();
  if (root) {
    process.chdir(root);
    return true;
  }
  return false;
}

/**
 * Check if current directory is a git repository
 */
export async function isGitRepo(): Promise<boolean> {
  try {
    await $`git rev-parse --git-dir`.quiet();
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if HEAD exists (false for initial commit)
 */
export async function hasHead(): Promise<boolean> {
  try {
    await $`git rev-parse HEAD`.quiet();
    return true;
  } catch {
    return false;
  }
}

/**
 * Get list of staged files
 */
export async function getStagedFiles(): Promise<string[]> {
  const output = (await $`git diff --cached --name-only`.text()).trim();
  return output ? output.split('\n') : [];
}

/**
 * Get staged diff
 */
export async function getStagedDiff(): Promise<string> {
  return await $`git diff --cached --diff-algorithm=minimal`.text();
}

/**
 * Get diff against HEAD
 */
export async function getHeadDiff(): Promise<string> {
  return await $`git diff HEAD --diff-algorithm=minimal`.text();
}

/**
 * Get git status in porcelain format
 */
export async function getStatus(): Promise<string> {
  return (await $`git status --porcelain`.text()).trim();
}

/**
 * Get submodule paths to exclude from staging
 */
export async function getSubmodulePaths(): Promise<Set<string>> {
  const paths = new Set<string>();
  try {
    const output = (await $`git config --file .gitmodules --get-regexp path`.quiet()).text();
    for (const line of output.split('\n').filter(Boolean)) {
      const match = line.match(/submodule\..*\.path\s+(.+)/);
      if (match) paths.add(match[1]);
    }
  } catch {
    // No .gitmodules or no submodules configured
  }
  return paths;
}

/**
 * Stage files
 */
export async function stageFiles(files: string[]): Promise<void> {
  await $`git add ${files}`;
}

/**
 * Create a commit with the given message
 */
export async function commit(message: string): Promise<void> {
  await $`git commit -m ${message}`.quiet();
}

/**
 * Push to remote
 */
export async function push(): Promise<void> {
  await $`git push`.quiet();
}

/**
 * Get recent commit log
 */
export async function getRecentCommits(count: number = 5): Promise<string[]> {
  try {
    const output = await $`git log --oneline -${count}`.text();
    return output.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Get recent commit messages (subject only, no hash)
 */
export async function getRecentCommitMessages(count: number = 3): Promise<string[]> {
  try {
    const output = await $`git log --format=%s -${count}`.text();
    return output.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Derive a human-readable hint from git status code
 */
function getStatusHint(status: string): string {
  if (status === '??') return 'new';
  if (status.includes('M')) return 'modified';
  if (status.includes('D')) return 'deleted';
  return status.trim();
}

/**
 * Parse changed files from porcelain status output
 */
export function parseStatusOutput(statusOutput: string): Array<{
  path: string;
  status: string;
  hint: string;
}> {
  return statusOutput
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const status = line.slice(0, 2);
      const path = line.slice(2).trimStart();
      return {
        hint: getStatusHint(status),
        path,
        status
      };
    });
}

/**
 * Create a git tag
 */
export async function createTag(tag: string, message?: string): Promise<void> {
  if (message) {
    await $`git tag -a ${tag} -m ${message}`.quiet();
  } else {
    await $`git tag ${tag}`.quiet();
  }
}

/**
 * Delete a git tag (local only)
 */
export async function deleteTag(tag: string): Promise<void> {
  await $`git tag -d ${tag}`.quiet();
}

/**
 * Check if a tag exists
 */
export async function tagExists(tag: string): Promise<boolean> {
  try {
    const output = await $`git tag -l ${tag}`.text();
    return output.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Get the latest tag
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
 * Get all tags sorted by version
 */
export async function getAllTags(): Promise<string[]> {
  try {
    const output = await $`git tag --sort=-v:refname`.text();
    return output.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Push to remote including tags
 */
export async function pushWithTags(): Promise<void> {
  await $`git push --follow-tags`.quiet();
}

/**
 * Push tags only
 */
export async function pushTags(): Promise<void> {
  await $`git push --tags`.quiet();
}

/**
 * Get commits since a tag/ref
 */
export async function getCommitsSince(ref: string): Promise<string> {
  try {
    return await $`git log ${ref}..HEAD --oneline`.text();
  } catch {
    // If ref doesn't exist, return all commits
    return await $`git log --oneline`.text();
  }
}

/**
 * Get diff since a tag/ref
 */
export async function getDiffSince(ref: string): Promise<string> {
  try {
    return await $`git diff ${ref}..HEAD --diff-algorithm=minimal`.text();
  } catch {
    return '';
  }
}

/**
 * Check if working directory is clean
 */
export async function isClean(): Promise<boolean> {
  const status = await getStatus();
  return status.length === 0;
}
