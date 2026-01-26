#!/bin/bash
# Update Homebrew formula with version and SHA256 hashes
#
# Usage:
#   ./scripts/update-homebrew-formula.sh 0.0.75
#
# This script:
#   1. Downloads all binaries from the release
#   2. Calculates SHA256 hashes
#   3. Updates the formula template
#   4. Optionally commits to homebrew-tap repo

set -e

VERSION="${1:-}"
REPO="veryfront/veryfront"

if [ -z "$VERSION" ]; then
  echo "Usage: $0 VERSION"
  echo "Example: $0 0.0.75"
  exit 1
fi

echo "Updating Homebrew formula for v${VERSION}..."

# Create temp directory
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# Download binaries and calculate hashes
declare -A HASHES

for binary in veryfront-macos-arm64 veryfront-macos-x64 veryfront-linux-arm64 veryfront-linux-x64; do
  echo "Downloading ${binary}..."
  URL="https://github.com/${REPO}/releases/download/v${VERSION}/${binary}"

  if curl -fsSL "$URL" -o "${TEMP_DIR}/${binary}"; then
    HASH=$(shasum -a 256 "${TEMP_DIR}/${binary}" | cut -d' ' -f1)
    HASHES[$binary]=$HASH
    echo "  SHA256: ${HASH}"
  else
    echo "  Failed to download ${binary}"
    exit 1
  fi
done

# Read template
TEMPLATE_PATH="$(dirname "$0")/../homebrew/veryfront.rb"
FORMULA=$(cat "$TEMPLATE_PATH")

# Replace placeholders
FORMULA="${FORMULA//VERSION_PLACEHOLDER/$VERSION}"
FORMULA="${FORMULA//SHA256_MACOS_ARM64_PLACEHOLDER/${HASHES[veryfront-macos-arm64]}}"
FORMULA="${FORMULA//SHA256_MACOS_X64_PLACEHOLDER/${HASHES[veryfront-macos-x64]}}"
FORMULA="${FORMULA//SHA256_LINUX_ARM64_PLACEHOLDER/${HASHES[veryfront-linux-arm64]}}"
FORMULA="${FORMULA//SHA256_LINUX_X64_PLACEHOLDER/${HASHES[veryfront-linux-x64]}}"

# Output updated formula
OUTPUT_PATH="${TEMP_DIR}/veryfront.rb"
echo "$FORMULA" > "$OUTPUT_PATH"

echo ""
echo "Updated formula written to: ${OUTPUT_PATH}"
echo ""
cat "$OUTPUT_PATH"
echo ""

# Check if homebrew-tap repo exists locally
TAP_REPO="${HOME}/vf2/homebrew-tap"
if [ -d "$TAP_REPO" ]; then
  echo ""
  read -p "Update ${TAP_REPO}/Formula/veryfront.rb? (y/N) " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    mkdir -p "${TAP_REPO}/Formula"
    cp "$OUTPUT_PATH" "${TAP_REPO}/Formula/veryfront.rb"
    echo "Formula updated at ${TAP_REPO}/Formula/veryfront.rb"
    echo ""
    echo "Next steps:"
    echo "  cd ${TAP_REPO}"
    echo "  git add Formula/veryfront.rb"
    echo "  git commit -m 'Update veryfront to v${VERSION}'"
    echo "  git push"
  fi
else
  echo "To publish to Homebrew tap:"
  echo "  1. Create repo: veryfront/homebrew-tap"
  echo "  2. Copy formula to: Formula/veryfront.rb"
  echo "  3. Users can install with: brew install veryfront/tap/veryfront"
fi
