default:
    @just --list

# Store .env secrets to system credential store (cross-platform)
setup:
    bun run scripts/setup-secrets.ts

# Remove secrets from system credential store (cross-platform)
teardown:
    bun run scripts/teardown-secrets.ts

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
