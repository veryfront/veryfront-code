# Manual Build and Deploy

This document describes how to manually build and deploy the Veryfront renderer.

## Prerequisites

- Docker with buildx support
- Authenticated to ghcr.io: `echo $GITHUB_TOKEN | docker login ghcr.io -u $GITHUB_USERNAME --password-stdin`
- kubectl configured with production kubeconfig
- Helm 3.x installed

## Build Process

### 1. Create a multiarch builder (one-time setup)

```bash
docker buildx create --name multiarch --driver docker-container --use
```

### 2. Build and push images

Use a unique tag based on commit SHA + timestamp to avoid cache issues:

```bash
export TAG="$(git rev-parse --short HEAD)-$(date +%s)"
echo "Building with tag: $TAG"

# Build renderer (linux/amd64 for k8s cluster)
docker buildx build --platform linux/amd64 \
  -f Dockerfile.renderer \
  -t ghcr.io/veryfront/veryfront-renderer:$TAG \
  --push .

# Build proxy
docker buildx build --platform linux/amd64 \
  -f Dockerfile.proxy \
  -t ghcr.io/veryfront/veryfront-proxy:$TAG \
  --push .
```

## Deploy Process

### Deploy with Helm

```bash
helm upgrade --install veryfront-renderer ./chart \
  --namespace veryfront-production \
  --set proxy.image.tag=$TAG \
  --set renderer.image.tag=$TAG \
  --wait --timeout 5m
```

### If Helm is stuck

```bash
# Rollback if another operation is in progress
helm rollback veryfront-renderer -n veryfront-production

# Then retry upgrade
helm upgrade --install veryfront-renderer ./chart \
  --namespace veryfront-production \
  --set proxy.image.tag=$TAG \
  --set renderer.image.tag=$TAG \
  --wait --timeout 5m
```

## Verification

### Check pod status

```bash
kubectl get pods -n veryfront-production -l 'app.kubernetes.io/name in (veryfront-renderer, veryfront-proxy)'
```

### Check logs

```bash
kubectl logs -n veryfront-production deployment/veryfront-renderer --tail=100
kubectl logs -n veryfront-production deployment/veryfront-proxy --tail=100
```

### Test endpoints

```bash
# Health check
curl -I https://your-site.preview.veryfront.com/_health

# Test a page
curl -I https://your-site.preview.veryfront.com/
```

## Troubleshooting

### "exec format error"

Architecture mismatch - the image was built for ARM but the cluster runs AMD64.
Rebuild with `--platform linux/amd64` using the multiarch builder.

### Pods use cached old image

Use a unique tag (with timestamp) instead of reusing existing tags. Kubernetes caches images by tag.

### "another operation in progress"

Run `helm rollback veryfront-renderer -n veryfront-production` first.
