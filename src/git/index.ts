const DEFAULT_COMMIT_COUNT = 5;
const DEFAULT_MESSAGE_COUNT = 3;
const STATUS_CODE_LENGTH = 2;

type GitCommandResult = {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
};

const runGit = async (...args: readonly string[]): Promise<GitCommandResult> => {
  const command = Bun.spawn(['git', ...args], { stderr: 'pipe', stdout: 'pipe' });
  const [exitCode, stderr, stdout] = await Promise.all([
    command.exited,
    new Response(command.stderr).text(),
    new Response(command.stdout).text(),
  ]);
  return { exitCode, stderr, stdout };
};

const succeeded = (result: GitCommandResult): boolean => result.exitCode === 0;

const outputOrThrow = (result: GitCommandResult): string => {
  if (succeeded(result)) {
    return result.stdout;
  }
  const message = result.stderr.trim();
  throw new Error(message.length > 0 ? message : 'git command failed');
};

export const getGitRoot = async (): Promise<string | null> => {
  const result = await runGit('rev-parse', '--show-toplevel');
  if (!succeeded(result)) {
    return null;
  }
  return result.stdout.trim();
};

export const cdToGitRoot = async (): Promise<boolean> => {
  const root = await getGitRoot();
  if (root === null) {
    return false;
  }
  process.chdir(root);
  return true;
};

export const isGitRepo = async (): Promise<boolean> => {
  const result = await runGit('rev-parse', '--git-dir');
  return succeeded(result);
};

export const hasHead = async (): Promise<boolean> => {
  const result = await runGit('rev-parse', 'HEAD');
  return succeeded(result);
};

export const getStagedFiles = async (): Promise<string[]> => {
  const output = outputOrThrow(await runGit('diff', '--cached', '--name-only')).trim();
  return output.length === 0 ? [] : output.split('\n');
};

export const getStagedDiff = async (): Promise<string> =>
  outputOrThrow(await runGit('diff', '--cached', '--diff-algorithm=minimal'));

export const getHeadDiff = async (): Promise<string> =>
  outputOrThrow(await runGit('diff', 'HEAD', '--diff-algorithm=minimal'));

export const getStatus = async (): Promise<string> =>
  outputOrThrow(await runGit('status', '--porcelain')).trim();

export const getSubmodulePaths = async (): Promise<Set<string>> => {
  const result = await runGit('config', '--file', '.gitmodules', '--get-regexp', 'path');
  if (!succeeded(result)) {
    return new Set();
  }
  const paths = new Set<string>();
  for (const line of result.stdout.split('\n').filter(Boolean)) {
    const match = /submodule\..*\.path\s+(?<path>.+)/u.exec(line);
    const path = match?.groups?.['path'];
    if (path !== undefined) {
      paths.add(path);
    }
  }
  return paths;
};

export const stageFiles = async (files: readonly string[]): Promise<void> => {
  outputOrThrow(await runGit('add', ...files));
};

export const commit = async (message: string): Promise<void> => {
  outputOrThrow(await runGit('commit', '-m', message));
};

export const push = async (): Promise<void> => {
  outputOrThrow(await runGit('push'));
};

export const getRecentCommits = async (count: number = DEFAULT_COMMIT_COUNT): Promise<string[]> => {
  const result = await runGit('log', '--oneline', `-${count}`);
  if (!succeeded(result)) {
    return [];
  }
  return result.stdout.trim().split('\n').filter(Boolean);
};

export const getRecentCommitMessages = async (
  count: number = DEFAULT_MESSAGE_COUNT,
): Promise<string[]> => {
  const result = await runGit('log', '--format=%s', `-${count}`);
  if (!succeeded(result)) {
    return [];
  }
  return result.stdout.trim().split('\n').filter(Boolean);
};

const getStatusHint = (status: string): string => {
  if (status === '??') {
    return 'new';
  }
  if (status.includes('M')) {
    return 'modified';
  }
  if (status.includes('D')) {
    return 'deleted';
  }
  return status.trim();
};

export const parseStatusOutput = (
  statusOutput: string,
): { path: string; status: string; hint: string }[] =>
  statusOutput
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const status = line.slice(0, STATUS_CODE_LENGTH);
      const path = line.slice(STATUS_CODE_LENGTH).trimStart();
      return { hint: getStatusHint(status), path, status };
    });

export const createTag = async (tag: string, message?: string): Promise<void> => {
  const versionTag = tag.startsWith('v') ? tag : `v${tag}`;
  if (message === undefined) {
    outputOrThrow(await runGit('tag', versionTag));
    return;
  }
  outputOrThrow(await runGit('tag', '-a', versionTag, '-m', message));
};

export const deleteTag = async (tag: string): Promise<void> => {
  const versionTag = tag.startsWith('v') ? tag : `v${tag}`;
  outputOrThrow(await runGit('tag', '-d', versionTag));
};

export const tagExists = async (tag: string): Promise<boolean> => {
  const versionTag = tag.startsWith('v') ? tag : `v${tag}`;
  const result = await runGit('tag', '-l', versionTag);
  return succeeded(result) && result.stdout.trim().length > 0;
};

export const getLatestTag = async (): Promise<string | null> => {
  const result = await runGit('describe', '--tags', '--abbrev=0');
  if (!succeeded(result)) {
    return null;
  }
  const tag = result.stdout.trim();
  return tag.length === 0 ? null : tag;
};

export const getAllTags = async (): Promise<string[]> => {
  const result = await runGit('tag', '--sort=-v:refname');
  if (!succeeded(result)) {
    return [];
  }
  return result.stdout.trim().split('\n').filter(Boolean);
};

export const pushWithTags = async (): Promise<void> => {
  outputOrThrow(await runGit('push', '--follow-tags'));
};

export const pushTags = async (): Promise<void> => {
  outputOrThrow(await runGit('push', '--tags'));
};

export const getCommitsSince = async (ref: string | null): Promise<string> => {
  const result =
    ref === null
      ? await runGit('log', '--oneline')
      : await runGit('log', `${ref}..HEAD`, '--oneline');
  if (succeeded(result)) {
    return result.stdout;
  }
  if (ref === null) {
    return '';
  }
  return outputOrThrow(await runGit('log', '--oneline'));
};

export const getDiffStatsSince = async (ref: string | null): Promise<string> => {
  const result =
    ref === null ? await runGit('diff', '--stat') : await runGit('diff', `${ref}..HEAD`, '--stat');
  return succeeded(result) ? result.stdout : '';
};

export const getDiffSince = async (ref: string | null): Promise<string> => {
  const result =
    ref === null
      ? await runGit('diff', '--diff-algorithm=minimal')
      : await runGit('diff', `${ref}..HEAD`, '--diff-algorithm=minimal');
  return succeeded(result) ? result.stdout : '';
};

export const isClean = async (): Promise<boolean> => {
  const status = await getStatus();
  return status.length === 0;
};
