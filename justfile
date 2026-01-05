default:
    @just --list

# Setup credentials (interactive)
setup:
    bun run src/index.ts setup

# Remove stored credentials
teardown:
    bun run src/index.ts teardown

# Run in development
dev:
    bun run src/index.ts

# Build and install to ~/.local/bin
build:
    bun build ./src/index.ts --compile --outfile aic --minify
    mkdir -p ~/.local/bin
    mv aic ~/.local/bin/
    rm -f ./.*bun-build
    @echo "✓ Installed to ~/.local/bin/aic"

# Install dependencies
install:
    bun install
