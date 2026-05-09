# AICommit (aic)

AI-powered commit message generator using conventional commit format.

## Features

- Analyzes git diffs to generate semantic commit messages
- Follows [conventional commits](https://www.conventionalcommits.org/) format
- Smart diff compression for large changesets
- Extracts semantic info (functions, types, classes) for better context
- Interactive file selection when no changes are staged
- Preset-based AI provider configuration (OpenAI-compatible APIs)
- Built-in Claude CLI support

## Installation

### Homebrew (recommended)

```bash
brew install seanmozeik/tap/aic
```

### From source

Requires [Bun](https://bun.sh) runtime.

```bash
git clone https://github.com/seanmozeik/AICommit.git
cd AICommit
bun install
bun run build
```

## Setup

aic supports both OpenAI-compatible APIs and the Claude CLI.

### Built-in Claude CLI

If you have the [Claude CLI](https://github.com/anthropics/claude-cli) installed, you can use it directly:

```bash
aic --preset claude
```

Or set it as your default preset:

```bash
aic setup
# Then select "Set default preset" and choose "claude"
```

### OpenAI-compatible APIs

Configure presets for different AI providers (OpenAI, OpenRouter, local models, etc.).

### Interactive setup (recommended)

```bash
aic setup
```

This prompts you to:

- Add new presets with base URL, API key, model name, and optional context window
- List existing presets
- Set default preset
- Delete presets

Presets are stored securely:

- **macOS**: Keychain
- **Linux**: libsecret (GNOME Keyring, KWallet, etc.)
- **Windows**: Credential Manager

Example presets:

- **OpenAI**: `https://api.openai.com/v1` with your API key
- **OpenRouter**: `https://openrouter.ai/api/v1` with your API key
- **Local**: `http://localhost:1234/v1` for LM Studio, Ollama, etc.

### Preset selection

Override the default preset:

```bash
aic --preset mypreset
```

### Project configuration

Optionally create a `.aic` file in your project root for project-specific preset overrides. See `.aic.example` for details.

## Usage

```bash
# Generate commit message for staged changes (uses default preset)
aic

# If nothing is staged, aic lets you select files interactively

# Use specific preset
aic --preset openrouter
aic --preset local
```

### Workflow

1. Stage your changes with `git add` (or let aic help you select)
2. Run `aic`
3. Optionally describe your changes when prompted
4. Review the generated message
5. Confirm to commit, edit, or copy to clipboard

## How It Works

1. Parses unified diff output from git
2. Classifies files (included, summarized, excluded)
3. Extracts semantic information (new functions, types, classes)
4. Compresses large diffs to fit token limits
5. Sends context to AI with conventional commit guidelines
6. Validates and formats the response

## Requirements

- Git
- Bun runtime
- OpenAI-compatible API endpoint and credentials (see Setup above), OR
- Claude CLI (for built-in `claude` preset)

### Linux clipboard (optional)

For clipboard support on Linux, install one of:

- `xclip` (X11)
- `xsel` (X11)
- `wl-copy` (Wayland)

## License

MIT
