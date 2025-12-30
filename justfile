default:
    @just --list

# Store .env secrets to macOS Keychain (macOS only)
setup-mac:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ ! -f .env ]]; then
        echo "Error: .env file not found"
        echo "Create one with AIC_CLOUDFLARE_ACCOUNT_ID and AIC_CLOUDFLARE_API_TOKEN"
        exit 1
    fi
    while IFS='=' read -r key value || [[ -n "$key" ]]; do
        [[ -z "$key" || "$key" =~ ^# ]] && continue
        value="${value#\"}" && value="${value%\"}"
        value="${value#\'}" && value="${value%\'}"
        security delete-generic-password -a "$USER" -s "$key" 2>/dev/null || true
        security add-generic-password -a "$USER" -s "$key" -w "$value"
        echo "✓ Stored $key"
    done < .env
    echo "Done! You can now delete .env"

# Remove secrets from macOS Keychain (macOS only)
teardown-mac:
    #!/usr/bin/env bash
    security delete-generic-password -a "$USER" -s "AIC_CLOUDFLARE_ACCOUNT_ID" 2>/dev/null && echo "✓ Removed AIC_CLOUDFLARE_ACCOUNT_ID" || echo "✗ AIC_CLOUDFLARE_ACCOUNT_ID not found"
    security delete-generic-password -a "$USER" -s "AIC_CLOUDFLARE_API_TOKEN" 2>/dev/null && echo "✓ Removed AIC_CLOUDFLARE_API_TOKEN" || echo "✗ AIC_CLOUDFLARE_API_TOKEN not found"

# Run in development
dev:
    bun run index.ts

# Build and install to ~/.local/bin
build:
    bun build ./index.ts --compile --outfile aic --minify
    mkdir -p ~/.local/bin
    mv aic ~/.local/bin/
    rm -f ./.*bun-build
    @echo "✓ Installed to ~/.local/bin/aic"

# Install dependencies
install:
    bun install
