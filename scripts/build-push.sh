#!/bin/bash
# Build and push images to GHCR
set -e

REGISTRY="ghcr.io/veryfront"
TAG="${1:-latest}"
BASE_TAG=$(sha256sum deno.json | cut -c1-16)

echo "Building with BASE_TAG=$BASE_TAG, TAG=$TAG"

# Build base if needed
if ! docker manifest inspect "$REGISTRY/veryfront-renderer-base:$BASE_TAG" > /dev/null 2>&1; then
  echo "Building base image..."
  docker build -f Dockerfile.base -t "$REGISTRY/veryfront-renderer-base:$BASE_TAG" .
  docker push "$REGISTRY/veryfront-renderer-base:$BASE_TAG"
fi

# Build proxy
docker build -f Dockerfile.proxy -t "$REGISTRY/veryfront-proxy:$TAG" .
docker push "$REGISTRY/veryfront-proxy:$TAG"

# Build renderer
docker build -f Dockerfile.renderer --build-arg BASE_TAG="$BASE_TAG" -t "$REGISTRY/veryfront-renderer:$TAG" .
docker push "$REGISTRY/veryfront-renderer:$TAG"

echo "Done! Pushed with tag: $TAG"
