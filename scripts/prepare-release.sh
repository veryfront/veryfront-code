#!/bin/bash

# Prepare Veryfront release
# Usage: ./scripts/prepare-release.sh <version>

set -e

VERSION=$1

if [ -z "$VERSION" ]; then
  echo "❌ Error: Version required"
  echo "Usage: ./scripts/prepare-release.sh <version>"
  echo "Example: ./scripts/prepare-release.sh 0.1.0"
  exit 1
fi

echo "🚀 Preparing Veryfront release v${VERSION}"
echo ""

# Update version in package.json
echo "📝 Updating package.json version..."
npm version $VERSION --no-git-tag-version

# Update version in deno.json
echo "📝 Updating deno.json version..."
sed -i '' "s/\"version\": \".*\"/\"version\": \"${VERSION}\"/" deno.json

# Build all binaries
echo ""
echo "🔨 Building binaries for all platforms..."
node scripts/build-all.js

# Create checksums
echo ""
echo "🔐 Creating checksums..."
cd dist
for file in veryfront-*; do
  if [ -f "$file" ]; then
    shasum -a 256 "$file" > "${file}.sha256"
    echo "   ✅ ${file}.sha256"
  fi
done
cd ..

echo ""
echo "✅ Release preparation complete!"
echo ""
echo "📝 Next steps:"
echo "   1. Review the changes: git diff"
echo "   2. Commit changes: git add . && git commit -m 'Release v${VERSION}'"
echo "   3. Create tag: git tag v${VERSION}"
echo "   4. Push: git push && git push --tags"
echo "   5. Create GitHub release with binaries from dist/"
echo "   6. Publish to npm: npm publish"
echo ""
echo "📦 Binaries ready in dist/:"
ls -lh dist/veryfront-*
