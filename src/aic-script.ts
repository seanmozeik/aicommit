import type { spinner } from '@clack/prompts';

import type { AicConfig } from './types';
import { theme } from './ui/theme';

const AIC_CONFIG_PATH = '.aic';

const parseAicContent = (content: string): AicConfig => {
  const config: AicConfig = {};
  let currentSection: keyof AicConfig | null = null;
  let pendingLine = '';

  for (const line of content.split('\n')) {
    const trimmed = line.trim();

    if (pendingLine || (trimmed && !trimmed.startsWith('#'))) {
      if (trimmed.endsWith('\\')) {
        pendingLine += `${trimmed.slice(0, -1)} `;
      } else {
        const fullLine = pendingLine + trimmed;
        pendingLine = '';

        const sectionMatch = /^\[(\w+)\]$/u.exec(fullLine);
        if (sectionMatch) {
          currentSection = sectionMatch[1] as keyof AicConfig;
          config[currentSection] = [];
        } else if (currentSection && config[currentSection]) {
          config[currentSection]?.push(fullLine);
        }
      }
    }
  }

  return config;
};

const parseAicConfig = async (): Promise<AicConfig | null> => {
  const file = Bun.file(AIC_CONFIG_PATH);
  if (!(await file.exists())) {
    return null;
  }

  const content = await file.text();
  return parseAicContent(content);
};

const hasAicConfig = async (): Promise<boolean> => Bun.file(AIC_CONFIG_PATH).exists();

const executeCommand = async (
  cmd: string,
  options: {
    readonly onError?: (error: string) => void;
    readonly onOutput?: (output: string) => void;
  },
): Promise<boolean> => {
  const proc = Bun.spawn({
    cmd: ['sh', '-c', cmd],
    stderr: 'inherit',
    stdin: 'inherit',
    stdout: 'inherit',
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    options.onError?.(`Command exited with code ${exitCode}`);
    return false;
  }
  options.onOutput?.(`Command completed: ${cmd}`);
  return true;
};

const executeSection = async (
  section: keyof AicConfig,
  config: AicConfig,
  options: {
    readonly dryRun?: boolean;
    readonly onError?: (error: string) => void;
    readonly onCommand?: (cmd: string) => void;
    readonly onOutput?: (output: string) => void;
  } = {},
): Promise<boolean> => {
  const commands = config[section];
  if (!commands || commands.length === 0) {
    return true;
  }

  for (const cmd of commands) {
    options.onCommand?.(cmd);

    if (!options.dryRun) {
      const success = await executeCommand(cmd, options);
      if (!success) {
        return false;
      }
    }
  }

  return true;
};

const flushStdout = (): void => {
  process.stdout.write('', () => null);
};

const executeSectionWithProgress = async (
  section: keyof AicConfig,
  config: AicConfig,
  s: ReturnType<typeof spinner>,
): Promise<boolean> => {
  const commands = config[section];
  if (!commands || commands.length === 0) {
    return true;
  }

  const total = commands.length;
  let index = 0;

  for (const cmd of commands) {
    index += 1;
    s.start(`Running command ${index}/${total}...`);

    s.stop(`Running command ${index}/${total}: ${cmd}`);
    const proc = Bun.spawn({
      cmd: ['sh', '-c', cmd],
      stderr: 'inherit',
      stdin: 'inherit',
      stdout: 'inherit',
    });
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      s.stop(theme.error(`Command failed: ${cmd}`));
      flushStdout();
      return false;
    }
  }

  s.stop(theme.success(`Completed ${total} release command${total > 1 ? 's' : ''}`));
  flushStdout();
  return true;
};

const DEFAULT_TEMPLATE = `# AICommit Release Configuration
# Commands run during release process

[ignore]
# Files or globs to omit from AI diff context
# Example: generated/**

[release]
# Add your build commands here
# Example: npm run build

[publish]
# Add your publish commands here
# Example: npm publish
`;

const GO_TEMPLATE = `# AICommit Release Configuration

[ignore]
# generated/**

[release]
go build -o dist/
go test ./...

[publish]
# Go modules are published via git tags
`;

const NODE_TEMPLATE = `# AICommit Release Configuration

[ignore]
# generated/**

[release]
bun run build

[publish]
# npm publish
`;

const PYTHON_TEMPLATE = `# AICommit Release Configuration

[ignore]
# generated/**

[release]
python -m build
pytest

[publish]
twine upload dist/*
`;

const RUST_TEMPLATE = `# AICommit Release Configuration

[ignore]
# generated/**

[release]
cargo build --release
cargo test

[publish]
cargo publish
`;

export const getDefaultAicTemplate = (projectType: string): string => {
  const templates: Record<string, string> = {
    default: DEFAULT_TEMPLATE,
    go: GO_TEMPLATE,
    node: NODE_TEMPLATE,
    python: PYTHON_TEMPLATE,
    rust: RUST_TEMPLATE,
  };

  return templates[projectType] ?? templates['default'];
};

export const initAicConfig = async (projectType: string): Promise<void> => {
  await Bun.write(AIC_CONFIG_PATH, getDefaultAicTemplate(projectType));
};

export {
  executeSection,
  executeSectionWithProgress,
  hasAicConfig,
  parseAicConfig,
  parseAicContent,
};
