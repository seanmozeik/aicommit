# AICommit (aic)

AI-powered conventional commit message generator.

## Features

- Generates one-line conventional commit messages from git diffs
- First-class GPT-5.6 Luna preset through Codex CLI with medium reasoning and fast mode
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

aic can use built-in CLI providers, a named Codex CLI Luna preset, or named OpenAI-compatible presets.

### Built-In Presets

```bash
aic --preset claude
aic --preset codex
```

- `claude` uses the Claude CLI.
- `codex` uses `codex exec` headlessly with `gpt-5.4-mini` and low reasoning.

### Codex GPT-5.6 Luna

Run `aic setup` and choose **Codex GPT-5.6 Luna**. The saved preset invokes the installed Codex CLI with model `gpt-5.6-luna`, medium reasoning, `service_tier = "fast"`, and `features.fast_mode = true`. AICommit uses the model catalog's 272,000-token context window for prompt budgeting. It does not request or store an OpenAI API key for Luna.

This preset requires an installed, authenticated Codex CLI. With ChatGPT sign-in, fast mode consumes ChatGPT credits at the fast-mode rate.

### Custom OpenAI-Compatible Presets

The custom option in `aic setup` remains available for OpenRouter, local LM Studio/Ollama-compatible servers, and other endpoints exposing `/v1/chat/completions`. AICommit rejects non-HTTPS remote endpoints; plain HTTP remains available only for loopback development servers.

```bash
aic setup
```

Setup stores:

- preset name
- base URL
- API key, when required
- model name
- model context window

Named preset metadata and custom API credentials are stored in the OS credential store: macOS Keychain, Linux libsecret, or Windows Credential Manager.

Custom examples:

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
aic --preset luna
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
5. Packs the complete request—fixed instructions, diff, files, semantics, and history—within the configured model window after reserving output tokens and a safety margin.
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
