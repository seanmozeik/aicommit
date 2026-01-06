export interface FileDiff {
  path: string;
  oldPath?: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  diff: string;
  additions: number;
  deletions: number;
}

export interface ParsedDiff {
  files: FileDiff[];
  totalAdditions: number;
  totalDeletions: number;
}

export interface SemanticInfo {
  functions: string[];
  types: string[];
  exports: string[];
  classes: string[];
}

export interface ClassifiedFiles {
  included: FileDiff[];
  summarized: FileDiff[];
  excluded: FileDiff[];
}

export interface GenerateResult {
  text: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

export type ModelType = 'cloudflare' | 'claude';

export type ReleaseType = 'patch' | 'minor' | 'major';

export type ProjectType = 'node' | 'python' | 'rust' | 'go' | 'elixir' | 'unknown';

export interface ProjectInfo {
  type: ProjectType;
  name: string;
  version: string;
  metadataFiles: string[]; // Files that contain version info
}

export interface ChangelogEntry {
  version: string;
  date: string;
  added: string[];
  changed: string[];
  fixed: string[];
  removed: string[];
}

export interface AicConfig {
  release?: string[]; // Commands to run during release
  build?: string[]; // Commands to run during build
  publish?: string[]; // Commands to run during publish
}

export interface CommitInfo {
  hash: string;
  message: string;
  type?: string; // feat, fix, etc.
  scope?: string;
  description?: string;
}
