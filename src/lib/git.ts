import { $ } from 'bun';

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
      const isUntracked = status === '??';
      const isModified = status.includes('M');
      const isDeleted = status.includes('D');
      return {
        hint: isUntracked ? 'new' : isModified ? 'modified' : isDeleted ? 'deleted' : status.trim(),
        path,
        status
      };
    });
}
