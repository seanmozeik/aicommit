# AICommit (aic)

AI-powered commit message generator using conventional commit format.

## Features

- Analyzes git diffs to generate semantic commit messages
- Supports Cloudflare AI (GPT-OSS 20B) and Claude CLI backends
- Follows [conventional commits](https://www.conventionalcommits.org/) format
- Smart diff compression for large changesets
- Extracts semantic info (functions, types, classes) for better context

## Requirements

- [Bun](https://bun.sh) runtime
- Git
- Cloudflare account with Workers AI access **or** [Claude CLI](https://docs.anthropic.com/en/docs/claude-cli)
- Just command runner (`brew install just` or `cargo install just`) (recommended)

### Linux clipboard (optional)

For clipboard support on Linux, install one of:

- `xclip` (X11)
- `xsel` (X11)
- `wl-copy` (Wayland)

## Installation

```bash
git clone https://github.com/your-username/aic.git
cd aic
bun install
just build
```

This installs the `aic` binary to `~/.local/bin/`. Make sure this is in your `PATH`.

## Configuration

### Option A: Environment Variables (all platforms)

Add to your shell profile (`.bashrc`, `.zshrc`, etc.):

```bash
export AIC_CLOUDFLARE_ACCOUNT_ID=your-account-id
export AIC_CLOUDFLARE_API_TOKEN=your-api-token
```

### Option B: macOS Keychain

1. Copy `.env.example` to `.env` and fill in your credentials
2. Run `just setup-mac` to store in Keychain
3. Delete the `.env` file

To remove credentials later: `just teardown-mac`

## Usage

```bash
# Generate commit message (uses Cloudflare by default)
aic

# Use Claude CLI instead
aic --model claude
```

### Workflow

1. Stage your changes with `git add` (optional)
2. Run `aic`
3. Optionally describe your changes when prompted
4. Review the generated message
5. Confirm to commit or copy to clipboard

If no files are staged, `aic` analyzes all uncommitted changes.

## How It Works

1. Parses unified diff output from git
2. Classifies files (included, summarized, excluded)
3. Extracts semantic information (new functions, types, classes)
4. Compresses large diffs to fit token limits
5. Sends context to AI with conventional commit guidelines
6. Validates and formats the response

## Development

```bash
# Install dependencies
bun install

# Run in development
just dev

# Build binary
just build
```

## License

MIT
