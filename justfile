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

# Build and install to ~/.local/bin (current platform)
build:
    bun build ./src/index.ts --compile --outfile aic --minify
    mkdir -p ~/.local/bin
    mv aic ~/.local/bin/
    rm -f ./.*bun-build
    @echo "✓ Installed to ~/.local/bin/aic"

# Build for all platforms (for release)
build-all: clean-dist
    #!/usr/bin/env bash
    set -euo pipefail
    mkdir -p dist

    targets=(
        "bun-darwin-arm64:aic-darwin-arm64"
        "bun-darwin-x64:aic-darwin-x64"
        "bun-linux-x64:aic-linux-x64"
        "bun-linux-arm64:aic-linux-arm64"
        "bun-windows-x64:aic-windows-x64.exe"
    )

    for entry in "${targets[@]}"; do
        target="${entry%%:*}"
        outfile="${entry##*:}"
        echo "Building $target..."
        bun build ./src/index.ts --compile --target="$target" --outfile "dist/$outfile" --minify
    done

    rm -f ./.*bun-build
    echo ""
    echo "✓ Built all targets in dist/"
    ls -lh dist/

# Clean dist directory
clean-dist:
    rm -rf dist

# Create release archives
release: build-all
    #!/usr/bin/env bash
    set -euo pipefail
    cd dist

    # Create tarballs for Unix platforms
    for f in aic-darwin-* aic-linux-*; do
        [[ -f "$f" ]] || continue
        tar -czvf "${f}.tar.gz" "$f"
        rm "$f"
    done

    # Create zip for Windows
    if [[ -f "aic-windows-x64.exe" ]]; then
        zip "aic-windows-x64.zip" "aic-windows-x64.exe"
        rm "aic-windows-x64.exe"
    fi

    echo ""
    echo "✓ Release archives:"
    ls -lh

# Generate SHA256 checksums for release
checksums:
    #!/usr/bin/env bash
    cd dist
    shasum -a 256 * > checksums.txt
    cat checksums.txt

# Update Homebrew formula with checksums (run after release)
update-formula version:
    #!/usr/bin/env bash
    set -euo pipefail

    if [[ ! -d dist ]]; then
        echo "Error: dist/ not found. Run 'just release' first."
        exit 1
    fi

    formula="homebrew/aic.rb"

    # Update version
    sed -i.bak "s/version \".*\"/version \"{{version}}\"/" "$formula"

    # Update checksums
    for archive in dist/*.tar.gz dist/*.zip; do
        [[ -f "$archive" ]] || continue
        name=$(basename "$archive")
        sha=$(shasum -a 256 "$archive" | cut -d' ' -f1)

        case "$name" in
            *darwin-arm64*) placeholder="PLACEHOLDER_DARWIN_ARM64_SHA256" ;;
            *darwin-x64*)   placeholder="PLACEHOLDER_DARWIN_X64_SHA256" ;;
            *linux-arm64*)  placeholder="PLACEHOLDER_LINUX_ARM64_SHA256" ;;
            *linux-x64*)    placeholder="PLACEHOLDER_LINUX_X64_SHA256" ;;
            *) continue ;;
        esac

        sed -i.bak "s/$placeholder/$sha/" "$formula"
        echo "Updated $name: $sha"
    done

    rm -f "$formula.bak"
    echo ""
    echo "✓ Updated $formula for version {{version}}"

# Install dependencies
install:
    bun install
