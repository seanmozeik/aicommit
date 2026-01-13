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

## Release Management

aic includes a complete release pipeline with AI-generated changelogs.

### Quick Start

```bash
# Initialize release config
aic release init

# Create a release
aic release patch   # 1.0.0 → 1.0.1
aic release minor   # 1.0.0 → 1.1.0
aic release major   # 1.0.0 → 2.0.0
```

### What Happens During a Release

1. **Version bump** - Updates package.json, pyproject.toml, Cargo.toml, etc.
2. **[release] scripts** - Runs build, test, packaging commands from `.aic`
3. **Changelog** - AI analyzes commits since last tag, generates user-friendly changelog
4. **Commit & tag** - Creates release commit and git tag
5. **Push** - Optionally pushes to remote with tags
6. **[publish] scripts** - Runs publish commands (npm publish, GitHub release, etc.)

### The `.aic` Config File

Create a `.aic` file in your project root to configure release scripts:

```ini
[release]
# Commands run BEFORE commit/tag (build, test, package)
bun run build
bun test

[publish]
# Commands run AFTER push (npm publish, GitHub release, etc.)
npm publish
```

#### Multi-line Commands

Use `\` for line continuations:

```ini
[publish]
# Update Homebrew formula and push to tap
VERSION=$(bun -p "require('./package.json').version") && \
sed -i '' "s/version \".*\"/version \"$VERSION\"/" Formula/app.rb && \
cp Formula/app.rb ~/homebrew-tap/Formula/ && \
cd ~/homebrew-tap && git add -A && git commit -m "app $VERSION" && git push
```

#### Syntax

- Lines starting with `#` are comments
- Empty lines are ignored
- Commands run sequentially; if one fails, release aborts
- All shell features work: pipes, redirects, `&&`, `$()`, etc.

### Example: Full Release Pipeline

```ini
[release]
# Clean and build
rm -rf dist
bun run build

# Cross-compile binaries
bun build ./src/index.ts --compile --target=bun-darwin-arm64 --outfile dist/app-darwin-arm64
bun build ./src/index.ts --compile --target=bun-linux-x64 --outfile dist/app-linux-x64

# Create archives
cd dist && for f in app-*; do tar -czvf "${f}.tar.gz" "$f" && rm "$f"; done

[publish]
# Create GitHub release with binaries
gh release create "v$(bun -p "require('./package.json').version")" \
  dist/*.tar.gz \
  --title "v$(bun -p "require('./package.json').version")" \
  --notes-file /tmp/release-notes.md
```

See `.aic.example` for more examples including Homebrew formula updates, npm/PyPI publishing, and Slack notifications.

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
