# AICommit (aic)

AI-powered conventional commit message generator.

## Features

- Generates one-line conventional commit messages from git diffs
- Supports arbitrary OpenAI-compatible chat completion endpoints
- Preset-based provider configuration with secure credential storage
- Built-in `claude` preset for Claude CLI
- Built-in `codex` preset for Codex CLI headless mode
- Token-budgeted diff packing with additions prioritized over removed-line evidence
- `.aic` project config for release commands and diff ignore patterns
- Interactive file selection when no changes are staged

## Installation

### Homebrew

```bash
brew install seanmozeik/tap/aic
```

### From Source

Requires [Bun](https://bun.sh).

```bash
git clone https://github.com/seanmozeik/AICommit.git
cd AICommit
bun install
bun run build
```

## Setup

aic can use built-in CLI providers or named OpenAI-compatible presets.

### Built-In Presets

```bash
aic --preset claude
aic --preset codex
```

- `claude` uses the Claude CLI.
- `codex` uses `codex exec` headlessly with `gpt-5.4-mini` and low reasoning.

### OpenAI-Compatible Presets

Use `aic setup` for OpenAI, OpenRouter, local LM Studio/Ollama-compatible servers, or any endpoint exposing `/v1/chat/completions`.

```bash
aic setup
```

Setup stores:

- preset name
- base URL
- API key, when required
- model name
- model context window

Presets are stored in the OS credential store: macOS Keychain, Linux libsecret, or Windows Credential Manager.

Examples:

- OpenAI: `https://api.openai.com/v1`
- OpenRouter: `https://openrouter.ai/api/v1`
- Local: `http://localhost:1234/v1`

Use a preset explicitly:

```bash
aic --preset openrouter
aic --preset local
```

## Usage

```bash
# Generate a commit message for staged changes
aic

# If nothing is staged, choose files interactively
aic

# Use a specific provider
aic --preset codex
aic --preset openrouter
```

Workflow:

1. Stage changes with `git add`, or let aic help select files.
2. Run `aic`.
3. Optionally describe the change.
4. Review the generated message.
5. Commit, edit, or copy it.

## Project Config

Create `.aic` in a project root for release automation and project-specific diff filtering.

```ini
[ignore]
dist/**
generated/**
package-lock.json

[release]
bun run build

[publish]
npm publish
```

`[ignore]` entries are exact paths, directories, or `Bun.Glob` patterns. Ignored files are removed from AI diff context before stats and prompt packing.

`[release]` commands run during `aic release`. Use this for build/test steps that should happen before the release commit and tag.

`[publish]` commands can run after the release commit/tag and optional push. This is intended for npm publishing, GitHub release creation, and tap updates.

Release supports semver bump arguments:

```bash
aic release patch # 0.3.10 -> 0.3.11
aic release minor # 0.3.10 -> 0.4.0
aic release major # 0.3.10 -> 1.0.0
```

## How It Works

1. Reads staged changes, or `HEAD` changes when nothing is staged.
2. Applies `.aic` ignore rules.
3. Parses unified git diff.
4. Builds a weighted diff digest:
   - source files before tests/docs/generated files
   - added lines before removed/replaced evidence
   - likely formatting noise marked as low signal
5. Packs context to a fraction of the configured model window.
6. Asks the selected provider for a conventional commit message.

## Requirements

- Git
- Bun runtime
- One of:
  - an OpenAI-compatible API endpoint and credentials
  - Claude CLI for `--preset claude`
  - Codex CLI for `--preset codex`

### Linux Clipboard

For clipboard support on Linux, install one of:

- `xclip`
- `xsel`
- `wl-copy`

## License

MIT
