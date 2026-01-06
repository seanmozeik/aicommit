import type { AicConfig } from '../types.js';

const AIC_CONFIG_PATH = '.aic';

/**
 * Parse a .aic configuration file
 *
 * Format supports sections like:
 *
 * [release]
 * npm run build
 * npm run test
 *
 * [publish]
 * npm publish
 *
 * # Comments start with #
 * # Empty lines are ignored
 */
export async function parseAicConfig(): Promise<AicConfig | null> {
  const file = Bun.file(AIC_CONFIG_PATH);
  if (!(await file.exists())) {
    return null;
  }

  const content = await file.text();
  return parseAicContent(content);
}

/**
 * Parse .aic file content into structured config
 */
export function parseAicContent(content: string): AicConfig {
  const config: AicConfig = {};
  let currentSection: keyof AicConfig | null = null;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    // Check for section header [name]
    const sectionMatch = trimmed.match(/^\[(\w+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1] as keyof AicConfig;
      config[currentSection] = [];
      continue;
    }

    // Add command to current section
    if (currentSection && config[currentSection]) {
      config[currentSection]?.push(trimmed);
    }
  }

  return config;
}

/**
 * Check if .aic config file exists
 */
export async function hasAicConfig(): Promise<boolean> {
  return await Bun.file(AIC_CONFIG_PATH).exists();
}

/**
 * Execute commands from a specific section
 */
export async function executeSection(
  section: keyof AicConfig,
  config: AicConfig,
  options: {
    onCommand?: (cmd: string) => void;
    onOutput?: (output: string) => void;
    onError?: (error: string) => void;
    dryRun?: boolean;
  } = {}
): Promise<boolean> {
  const commands = config[section];
  if (!commands || commands.length === 0) {
    return true;
  }

  for (const cmd of commands) {
    options.onCommand?.(cmd);

    if (options.dryRun) {
      continue;
    }

    try {
      // Use shell to execute the command (supports pipes, redirects, etc.)
      const proc = Bun.spawn({
        cmd: ['sh', '-c', cmd],
        stderr: 'pipe',
        stdout: 'pipe'
      });

      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text()
      ]);

      const exitCode = await proc.exited;

      if (stdout.trim()) {
        options.onOutput?.(stdout.trim());
      }

      if (exitCode !== 0) {
        const error = stderr.trim() || `Command exited with code ${exitCode}`;
        options.onError?.(error);
        return false;
      }

      if (stderr.trim() && exitCode === 0) {
        // Some commands output to stderr even on success
        options.onOutput?.(stderr.trim());
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      options.onError?.(message);
      return false;
    }
  }

  return true;
}

/**
 * Create a default .aic template
 */
export function getDefaultAicTemplate(projectType: string): string {
  const templates: Record<string, string> = {
    default: `# AICommit Release Configuration
# Commands run during release process

[release]
# Add your build commands here
# Example: npm run build

[publish]
# Add your publish commands here
# Example: npm publish
`,
    go: `# AICommit Release Configuration
# Commands run during release process

[release]
# Build the project
go build -o dist/

# Run tests
go test ./...

[publish]
# Go modules are published via git tags
# No additional publish step needed
`,
    node: `# AICommit Release Configuration
# Commands run during release process

[release]
# Build the project
bun run build

# Run tests (uncomment if you have tests)
# bun test

[publish]
# Optional: publish to npm
# npm publish
`,
    python: `# AICommit Release Configuration
# Commands run during release process

[release]
# Build the project
python -m build

# Run tests
pytest

[publish]
# Optional: publish to PyPI
# twine upload dist/*
`,
    rust: `# AICommit Release Configuration
# Commands run during release process

[release]
# Build the project
cargo build --release

# Run tests
cargo test

[publish]
# Optional: publish to crates.io
# cargo publish
`
  };

  return templates[projectType] || templates.default;
}

/**
 * Write a default .aic template to the project
 */
export async function initAicConfig(projectType: string): Promise<void> {
  const template = getDefaultAicTemplate(projectType);
  await Bun.write(AIC_CONFIG_PATH, template);
}
