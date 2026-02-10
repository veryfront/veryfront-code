# Veryfront Distribution Guide

Complete guide for distributing and installing Veryfront across multiple platforms and package managers.

## Distribution Overview

Veryfront supports multiple distribution methods to serve different user needs:

| Method | Best For | Installation | Size |
|--------|----------|--------------|------|
| **Direct Binary** | Users without Node/Deno | Download + chmod | ~254MB (all-in-one) |
| **npm Package** | Node.js users | npm install | ~50KB (downloads binary) |
| **Homebrew** | macOS/Linux users | brew install | Managed by Homebrew |
| **Deno Module** | Deno users | deno install | ~5MB (requires Deno) |

## Quick Start for Users

### Option 1: Direct Binary Download

No dependencies required - just download and run:

```bash
# Download with install script
curl -fsSL https://veryfront.com/install.sh | sh

# Or download directly for your platform:

# macOS (Apple Silicon)
wget https://github.com/veryfront/veryfront/releases/latest/download/veryfront-aarch64-apple-darwin
chmod +x veryfront-aarch64-apple-darwin
sudo mv veryfront-aarch64-apple-darwin /usr/local/bin/veryfront

# macOS (Intel)
wget https://github.com/veryfront/veryfront/releases/latest/download/veryfront-x86_64-apple-darwin
chmod +x veryfront-x86_64-apple-darwin
sudo mv veryfront-x86_64-apple-darwin /usr/local/bin/veryfront

# Linux (x64)
wget https://github.com/veryfront/veryfront/releases/latest/download/veryfront-x86_64-unknown-linux-gnu
chmod +x veryfront-x86_64-unknown-linux-gnu
sudo mv veryfront-x86_64-unknown-linux-gnu /usr/local/bin/veryfront

# Windows (x64)
# Download veryfront-x86_64-pc-windows-msvc.exe
# Add to PATH
```

### Option 2: npm (Downloads Binary Automatically)

For Node.js users - npm downloads the appropriate binary during postinstall:

```bash
npm install -g veryfront
# Automatically downloads binary for your platform
```

### Option 3: Homebrew (Future)

```bash
brew tap veryfront/veryfront
brew install veryfront
```

### Verify Installation

```bash
veryfront --version
veryfront --help

# Create a new project
veryfront init my-app
cd my-app
veryfront dev
```

## Benefits by Distribution Method

### Direct Binary
- No Deno/Node.js required
- Single file (~254MB with all dependencies)
- Fast startup
- Offline use
- Larger download size
- Manual updates

### npm Package
- Familiar to Node.js users
- Small package (~50KB)
- Easy updates (npm update)
- Automatic binary download
- Requires Node.js
- Downloads binary on first install

### Deno Module
- Smallest download (~5MB)
- Auto-updates
- Native to Deno ecosystem
- Requires Deno installation
- Online required for first run

## Building Binaries (For Maintainers)

### Prerequisites

- **Deno** 2.x or later
- **Node.js** (for npm publishing)
- **GitHub account** (for hosting binaries)

### Build All Platform Binaries

```bash
# Build all platforms at once
node scripts/build/build-all.js
```

This creates binaries in `dist/`:

| Platform | File | Target |
|----------|------|--------|
| macOS Apple Silicon | `veryfront-macos-arm64` | `aarch64-apple-darwin` |
| macOS Intel | `veryfront-macos-x64` | `x86_64-apple-darwin` |
| Linux x64 | `veryfront-linux-x64` | `x86_64-unknown-linux-gnu` |
| Linux ARM64 | `veryfront-linux-arm64` | `aarch64-unknown-linux-gnu` |
| Windows x64 | `veryfront-windows-x64.exe` | `x86_64-pc-windows-msvc` |

### Build Individual Platform

```bash
# macOS ARM (M1/M2/M3)
deno compile --allow-all \
  --target aarch64-apple-darwin \
  --output dist/veryfront-macos-arm64 \
  src/cli/main.ts

# macOS Intel
deno compile --allow-all \
  --target x86_64-apple-darwin \
  --output dist/veryfront-macos-x64 \
  src/cli/main.ts

# Linux x64
deno compile --allow-all \
  --target x86_64-unknown-linux-gnu \
  --output dist/veryfront-linux-x64 \
  src/cli/main.ts

# Linux ARM64
deno compile --allow-all \
  --target aarch64-unknown-linux-gnu \
  --output dist/veryfront-linux-arm64 \
  src/cli/main.ts

# Windows x64
deno compile --allow-all \
  --target x86_64-pc-windows-msvc \
  --output dist/veryfront-windows-x64.exe \
  src/cli/main.ts
```

### Test Binaries

```bash
# Test help
./dist/veryfront-macos-arm64 --version
./dist/veryfront-macos-arm64 --help

# Test init command
./dist/veryfront-macos-arm64 init test-app
cd test-app
../dist/veryfront-macos-arm64 dev
```

## Release Process

### 1. Prepare Release

```bash
# Use the release script
deno task release 0.1.0

# Or manually update:
# - npm/package.json (version)
# - deno.json (version)
```

### 2. Build All Binaries

```bash
# Build for all platforms
node scripts/build/build-all.js

# Verify all binaries exist
ls -lh dist/
```

### 3. Generate Checksums

```bash
# Generate SHA256 checksums
cd dist
sha256sum veryfront-* > checksums.txt
cd ..
```

### 4. Commit and Tag

```bash
# Review changes
git diff

# Commit release
git add .
git commit -m "Release v0.1.0"

# Tag release
git tag v0.1.0

# Push to GitHub
git push && git push --tags
```

### 5. Create GitHub Release

```bash
# Option A: Using GitHub CLI
gh release create v0.1.0 \
  dist/veryfront-* \
  dist/checksums.txt \
  --title "Veryfront v0.1.0" \
  --notes "Release notes here"

# Option B: Manual
# 1. Go to: https://github.com/yourusername/veryfront/releases/new
# 2. Select tag: v0.1.0
# 3. Upload all binaries from dist/
# 4. Upload checksums.txt
# 5. Write release notes
# 6. Publish release
```

### 6. Publish to npm

```bash
# Login to npm (first time only)
npm login

# Publish package
npm publish

# Or publish as beta
npm publish --tag beta

# Test installation
npm install -g veryfront
veryfront --version
```

### 7. Publish to JSR (Optional)

```bash
# Publish to JSR (Deno registry)
deno publish
```

## How npm Distribution Works

The npm package uses a clever postinstall approach:

1. **User runs**: `npm install veryfront`
2. **npm runs**: `scripts/postinstall.js`
3. **Script**:
   - Detects platform (macOS/Linux/Windows, x64/ARM64)
   - Downloads appropriate binary from GitHub Releases
   - Places it in `node_modules/.bin/veryfront`
   - Makes it executable

### Benefits
- Small npm package (~50KB)
- Binaries hosted on GitHub (free)
- Users only download their platform's binary
- No need to publish large binaries to npm

## Distribution Channels

### 1. GitHub Releases (Primary)

**Setup**: Automatic via release process above

**Features**:
- Binary hosting
- Version management
- Checksums for verification
- Release notes

### 2. npm Registry

**Setup**:
```bash
npm publish
```

**Features**:
- Familiar to Node.js users
- Automatic binary download
- Version management with semver

### 3. Homebrew (Future)

**Setup**:
```bash
# Create Homebrew tap
brew tap veryfront/veryfront

# Create formula
cat > veryfront.rb <<EOF
class Veryfront < Formula
  desc "Modern React meta-framework"
  homepage "https://veryfront.com"
  version "0.1.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/veryfront/veryfront/releases/download/v0.1.0/veryfront-macos-arm64"
      sha256 "..."
    else
      url "https://github.com/veryfront/veryfront/releases/download/v0.1.0/veryfront-macos-x64"
      sha256 "..."
    end
  end

  on_linux do
    url "https://github.com/veryfront/veryfront/releases/download/v0.1.0/veryfront-linux-x64"
    sha256 "..."
  end

  def install
    bin.install "veryfront-macos-arm64" => "veryfront"
  end
end
EOF
```

### 4. Other Package Managers (Future)

- **Chocolatey** (Windows)
- **Scoop** (Windows)
- **AUR** (Arch Linux)
- **Snapcraft** (Linux)

## Install Script

Create `install.sh` for automated installation:

```bash
#!/bin/sh
# Veryfront installer

set -e

# Detect OS and architecture
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin)
    case "$ARCH" in
      arm64) TARGET="aarch64-apple-darwin" ;;
      x86_64) TARGET="x86_64-apple-darwin" ;;
      *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
    esac
    ;;
  Linux)
    case "$ARCH" in
      x86_64) TARGET="x86_64-unknown-linux-gnu" ;;
      aarch64) TARGET="aarch64-unknown-linux-gnu" ;;
      *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
    esac
    ;;
  *)
    echo "Unsupported OS: $OS"
    exit 1
    ;;
esac

VERSION="${1:-latest}"
BINARY="veryfront-$TARGET"
URL="https://github.com/veryfront/veryfront/releases/$VERSION/download/$BINARY"

echo "Installing Veryfront for $TARGET..."
curl -fsSL "$URL" -o veryfront
chmod +x veryfront
sudo mv veryfront /usr/local/bin/veryfront

echo "✓ Veryfront installed successfully!"
echo ""
echo "Get started:"
echo "  veryfront init my-app"
echo "  cd my-app"
echo "  veryfront dev"
```

## Security

### Binary Signing (macOS)

```bash
# Sign binary for macOS distribution
codesign -s "Developer ID Application" dist/veryfront-macos-arm64
codesign -s "Developer ID Application" dist/veryfront-macos-x64
```

### Checksums

```bash
# Generate checksums
cd dist
sha256sum veryfront-* > checksums.txt

# Verify
sha256sum -c checksums.txt
```

### GPG Signatures

```bash
# Sign release
gpg --armor --detach-sign dist/veryfront-macos-arm64

# Verify
gpg --verify dist/veryfront-macos-arm64.asc dist/veryfront-macos-arm64
```

## Binary Size Optimization

**Current size**: ~254MB per binary

**Why is it large?**
- Deno runtime (~150MB)
- TypeScript compiler
- All dependencies (React, esbuild, etc.)
- Framework code

**Optimization options**:

1. **UPX Compression** (reduces to ~80MB):
```bash
# Install UPX
brew install upx  # macOS
apt install upx   # Linux

# Compress binary
upx --best --lzma dist/veryfront-macos-arm64

# Result: ~254MB → ~80MB
```

**Trade-off**: +1-2 seconds startup time for decompression

2. **Lazy Loading**: Download dependencies on first use
3. **Modular Binaries**: Separate CLI from runtime
4. **Separate Runtime**: Require Deno installation

## Versioning

Follow [Semantic Versioning](https://semver.org/):

- **Major** (1.0.0): Breaking changes
- **Minor** (0.1.0): New features, backwards compatible
- **Patch** (0.0.1): Bug fixes

## CI/CD Automation

Automate releases with GitHub Actions:

```yaml
# .github/workflows/publish.yml
name: Publish

on:
  push:
    tags:
      - 'v*'

jobs:
  build:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        include:
          - os: macos-latest
            target: aarch64-apple-darwin
            output: veryfront-macos-arm64
          - os: macos-latest
            target: x86_64-apple-darwin
            output: veryfront-macos-x64
          - os: ubuntu-latest
            target: x86_64-unknown-linux-gnu
            output: veryfront-linux-x64
          - os: ubuntu-latest
            target: aarch64-unknown-linux-gnu
            output: veryfront-linux-arm64
          - os: windows-latest
            target: x86_64-pc-windows-msvc
            output: veryfront-windows-x64.exe

    steps:
      - uses: actions/checkout@v4
      - uses: denoland/setup-deno@v1
        with:
          deno-version: v2.x

      - name: Build binary
        run: |
          deno compile --allow-all \
            --target ${{ matrix.target }} \
            --output dist/${{ matrix.output }} \
            src/cli/main.ts

      - name: Generate checksum
        run: |
          cd dist
          sha256sum ${{ matrix.output }} > ${{ matrix.output }}.sha256

      - name: Upload Release Assets
        uses: softprops/action-gh-release@v1
        with:
          files: |
            dist/${{ matrix.output }}
            dist/${{ matrix.output }}.sha256
```

## Troubleshooting

### "Permission denied" error

```bash
chmod +x veryfront
```

### "Binary is damaged" (macOS)

```bash
# Remove quarantine attribute
xattr -d com.apple.quarantine veryfront
```

### "Command not found"

```bash
# Verify PATH includes /usr/local/bin
echo $PATH

# Add to PATH if needed
echo 'export PATH="/usr/local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

### npm postinstall fails

Users will see an error message with manual instructions:
1. Download binary from GitHub releases
2. Place in PATH as `veryfront`
3. Make executable with `chmod +x`

### Wrong binary downloaded

Check platform detection in `scripts/postinstall.js`:
```javascript
const platform = os.platform(); // darwin, linux, win32
const arch = os.arch();         // x64, arm64
```

## Future Updates

### Planned Distribution Channels
- Homebrew tap
- Chocolatey (Windows)
- Scoop (Windows)
- AUR (Arch Linux)
- Snapcraft (Linux)
- Docker Hub (containerized version)

### Planned Features
- Automatic update checker
- Self-update command (`veryfront update`)
- Telemetry (opt-in)
- Usage statistics

## Support

For distribution issues, see:
- [npm Publishing Docs](https://docs.npmjs.com/cli/v10/commands/npm-publish)
- [Deno Compile](https://docs.deno.com/runtime/reference/cli/compiler/)
- [GitHub Releases](https://docs.github.com/en/repositories/releasing-projects-on-github)
