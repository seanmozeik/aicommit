import type { spinner } from '@clack/prompts';
import { Effect } from 'effect';

import type { AicConfig } from './types';
import { theme } from './ui/theme';

const AIC_CONFIG_PATH = '.aic';
const AIC_SECTIONS = ['ignore', 'release', 'build', 'publish'] as const;

const isAicSection = (value: string): value is keyof AicConfig =>
  AIC_SECTIONS.some((section) => section === value);

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
        const section = sectionMatch?.[1];
        if (section !== undefined && isAicSection(section)) {
          currentSection = section;
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

const hasAicConfig = (): Promise<boolean> => Bun.file(AIC_CONFIG_PATH).exists();

const waitForCommand = (cmd: string): Effect.Effect<number, unknown> =>
  Effect.tryPromise(async () => {
    const proc = Bun.spawn({
      cmd: ['sh', '-c', cmd],
      stderr: 'inherit',
      stdin: 'inherit',
      stdout: 'inherit',
    });
    const abort = (): void => {
      proc.kill('SIGINT');
    };
    process.once('SIGINT', abort);
    try {
      return await proc.exited;
    } finally {
      process.off('SIGINT', abort);
    }
  });

const executeCommand = (
  cmd: string,
  options: {
    readonly onError?: (error: string) => void;
    readonly onOutput?: (output: string) => void;
  },
): Effect.Effect<boolean, unknown> =>
  Effect.gen(function* executeCommandGen() {
    const exitCode = yield* waitForCommand(cmd);
    if (exitCode !== 0) {
      options.onError?.(`Command exited with code ${exitCode}`);
      return false;
    }
    options.onOutput?.(`Command completed: ${cmd}`);
    return true;
  });

const executeSection = (
  section: keyof AicConfig,
  config: AicConfig,
  options: {
    readonly dryRun?: boolean;
    readonly onError?: (error: string) => void;
    readonly onCommand?: (cmd: string) => void;
    readonly onOutput?: (output: string) => void;
  } = {},
): Promise<boolean> =>
  Effect.runPromise(
    Effect.gen(function* executeSectionGen() {
      const commands = config[section];
      if (!commands || commands.length === 0) {
        return true;
      }

      const runCommandAt = (index: number): Effect.Effect<boolean, unknown> =>
        Effect.gen(function* executeSectionCommand() {
          if (index >= commands.length) {
            return true;
          }
          const cmd = commands[index];
          options.onCommand?.(cmd);

          if (options.dryRun !== true) {
            const success = yield* executeCommand(cmd, options);
            if (!success) {
              return false;
            }
          }
          return yield* runCommandAt(index + 1);
        });

      return yield* runCommandAt(0);
    }),
  );

const flushStdout = (): void => {
  process.stdout.write('');
};

const runProgressCommand = (
  cmd: string,
  index: number,
  total: number,
  s: ReturnType<typeof spinner>,
): Effect.Effect<boolean, unknown> =>
  Effect.gen(function* runProgressCommandGen() {
    s.start(`Running command ${index}/${total}...`);
    s.stop(`Running command ${index}/${total}: ${cmd}`);
    const exitCode = yield* waitForCommand(cmd);

    if (exitCode !== 0) {
      s.stop(theme.error(`Command failed: ${cmd}`));
      flushStdout();
      return false;
    }
    return true;
  });

const executeSectionWithProgress = (
  section: keyof AicConfig,
  config: AicConfig,
  s: ReturnType<typeof spinner>,
): Promise<boolean> =>
  Effect.runPromise(
    Effect.gen(function* executeSectionWithProgressGen() {
      const commands = config[section];
      if (!commands || commands.length === 0) {
        return true;
      }

      const runCommandAt = (index: number): Effect.Effect<boolean, unknown> =>
        Effect.gen(function* executeProgressCommand() {
          if (index >= commands.length) {
            return true;
          }
          const cmd = commands[index];
          const success = yield* runProgressCommand(cmd, index + 1, commands.length, s);
          if (!success) {
            return false;
          }
          return yield* runCommandAt(index + 1);
        });

      const completed = yield* runCommandAt(0);

      if (!completed) {
        return false;
      }

      s.stop(
        theme.success(
          `Completed ${commands.length} release command${commands.length > 1 ? 's' : ''}`,
        ),
      );
      flushStdout();
      return true;
    }),
  );

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
