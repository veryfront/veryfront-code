# Veryfront Renderer Helm Chart

Kubernetes deployment for Veryfront Renderer and Proxy.

## Prerequisites

- Kubernetes cluster with Traefik ingress controller
- Docker registry credentials for ghcr.io
- Required secrets in namespace

## Manual Deployment

### 1. Build and Push Docker Images

Build for amd64 (required for k8s cluster):

```bash
# Get current commit SHA
COMMIT_SHA=$(git rev-parse HEAD)

# Build renderer image for amd64
docker build --platform linux/amd64 -f Dockerfile.renderer -t ghcr.io/veryfront/veryfront-renderer:$COMMIT_SHA .

# Build proxy image for amd64
docker build --platform linux/amd64 -f Dockerfile.proxy -t ghcr.io/veryfront/veryfront-proxy:$COMMIT_SHA .

# Push images
docker push ghcr.io/veryfront/veryfront-renderer:$COMMIT_SHA
docker push ghcr.io/veryfront/veryfront-proxy:$COMMIT_SHA
```

**Important**: Always use `--platform linux/amd64` on Apple Silicon Macs. ARM images will fail with `exec format error` on amd64 clusters.

### 2. Deploy to Kubernetes

```bash
COMMIT_SHA=$(git rev-parse HEAD)

helm upgrade veryfront-renderer ./chart \
  --namespace veryfront-production \
  --set renderer.image.tag=$COMMIT_SHA \
  --set proxy.image.tag=$COMMIT_SHA
```

### 3. Verify Deployment

```bash
# Watch pods come up
kubectl get pods -n veryfront-production -l app.kubernetes.io/instance=veryfront-renderer -w

# Check logs
kubectl logs -l app.kubernetes.io/component=renderer -n veryfront-production --tail=50

# Restart deployment (if needed)
kubectl rollout restart deployment veryfront-renderer -n veryfront-production
```

## Quick Deploy Script

One-liner for common case:

```bash
COMMIT_SHA=$(git rev-parse HEAD) && \
docker build --platform linux/amd64 -f Dockerfile.renderer -t ghcr.io/veryfront/veryfront-renderer:$COMMIT_SHA . && \
docker push ghcr.io/veryfront/veryfront-renderer:$COMMIT_SHA && \
helm upgrade veryfront-renderer ./chart --namespace veryfront-production --set renderer.image.tag=$COMMIT_SHA --set proxy.image.tag=$COMMIT_SHA && \
kubectl rollout restart deployment veryfront-renderer -n veryfront-production
```

## Configuration

See `values.yaml` for all configuration options.

Key settings:
- `renderer.replicaCount`: Number of renderer pods (default: 6)
- `proxy.replicaCount`: Number of proxy pods (default: 2)
- `renderer.image.tag`: Docker image tag for renderer
- `proxy.image.tag`: Docker image tag for proxy

## Troubleshooting

### exec format error
Image built for wrong architecture. Rebuild with `--platform linux/amd64`.

### ErrImagePull
Check image tag exists and registry credentials are configured.

### CrashLoopBackOff
Check pod logs: `kubectl logs <pod-name> -n veryfront-production`
