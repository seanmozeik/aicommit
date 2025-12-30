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
