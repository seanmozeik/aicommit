# AICommit (aic)

AI-powered commit message generator using conventional commit format.

## Features

- Analyzes git diffs to generate semantic commit messages
- Follows [conventional commits](https://www.conventionalcommits.org/) format
- Smart diff compression for large changesets
- Extracts semantic info (functions, types, classes) for better context
- Interactive file selection when no changes are staged
- Built-in release management with changelog generation

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

aic uses Cloudflare Workers AI. You'll need a Cloudflare account with Workers AI access.

### Interactive setup (recommended)

```bash
aic setup
```

This prompts for your credentials and stores them securely:
- **macOS**: Keychain
- **Linux**: libsecret (GNOME Keyring, KWallet, etc.)
- **Windows**: Credential Manager

To remove stored credentials:

```bash
aic teardown
```

### Environment variables

Alternatively, add to your shell profile:

```bash
export AIC_CLOUDFLARE_ACCOUNT_ID=your-account-id
export AIC_CLOUDFLARE_API_TOKEN=your-api-token
```

## Usage

```bash
# Generate commit message for staged changes
aic

# If nothing is staged, aic lets you select files interactively
```

### Workflow

1. Stage your changes with `git add` (or let aic help you select)
2. Run `aic`
3. Optionally describe your changes when prompted
4. Review the generated message
5. Confirm to commit, edit, or copy to clipboard

### Release management

aic includes built-in release tooling:

```bash
# Initialize release config (.aic file)
aic release init

# Create a release
aic release patch   # 1.0.0 → 1.0.1
aic release minor   # 1.0.0 → 1.1.0
aic release major   # 1.0.0 → 2.0.0
```

The release command:
- Bumps version in package.json (or pyproject.toml, Cargo.toml, etc.)
- Runs configured build scripts
- Generates AI-powered changelog
- Creates git tag
- Optionally pushes and publishes

## How It Works

1. Parses unified diff output from git
2. Classifies files (included, summarized, excluded)
3. Extracts semantic information (new functions, types, classes)
4. Compresses large diffs to fit token limits
5. Sends context to AI with conventional commit guidelines
6. Validates and formats the response

## Requirements

- Git
- Cloudflare account with Workers AI access

### Linux clipboard (optional)

For clipboard support on Linux, install one of:
- `xclip` (X11)
- `xsel` (X11)
- `wl-copy` (Wayland)

## License

MIT
