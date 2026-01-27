# Troubleshooting Renderer 500 Errors

Quick guide to debug production 500 errors. Goal: identify root cause in < 15 minutes.

**Runbooks**: See `veryfront-observability/runbooks/renderer-*.md` for operational runbooks.

## Step 1: Reproduce Locally (2 min)

Always start here. Local reproduction gives full stack traces and faster iteration.

```bash
cd veryfront-renderer

# Use production cache (this is key - reproduces cross-environment cache issues)
VERYFRONT_API_BASE_URL=https://api.veryfront.com PROXY_MODE=1 deno task start
```

Then visit the affected site:
```bash
open "http://{project-slug}.veryfront.me:8080/"
```

**If it reproduces locally**: You have the full error. Skip to Step 3.

**If it doesn't reproduce**: The issue is pod-specific (memory, network, stale state). Check production logs directly.

## Step 2: Get Error Context (2 min)

### Quick Log Query

```bash
KC="--kubeconfig ~/.kube/veryfront-oidc.yaml"
NS="-n veryfront-production"

# Last 50 errors with context
kubectl $KC logs $NS deployment/veryfront-renderer --tail=500 | grep -B2 -A2 "error\|Error\|500"
```

### Categorize the Error

| Error Pattern | Category | Jump To |
|---------------|----------|---------|
| `Module not found "file://..."` | Cache path mismatch | [Cache Issues](#cache-issues) |
| `Transform failed` | Transform error | [Transform Issues](#transform-issues) |
| `timeout` / `stuck` | Performance | [Performance Issues](#performance-issues) |
| `Cannot read property` / `undefined` | Code bug | [Code Issues](#code-issues) |
| `ECONNREFUSED` / `fetch failed` | Network | [Network Issues](#network-issues) |

## Step 3: Fix by Category

### Cache Issues

**Symptom**: `Module not found "file:///app/..."` or `Invalid or unexpected token`

**Root cause**: Cached code has paths from different environment.

**Quick fix** (clears cache for one project):
```bash
# Find projectId from logs, then:
curl -X DELETE "https://api.veryfront.com/internal/cache/project/{projectId}/transforms" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Nuclear option** (clears all transform cache):
```bash
kubectl $KC rollout restart deployment/veryfront-renderer $NS
```

**Verify fix**: Visit the site again. First load will be slow (cold cache), then fast.

---

### Transform Issues

**Symptom**: `Transform failed for module`, `ESM transform error`

**Debug locally**:
```bash
# Enable verbose transform logging
DEBUG=vf:transform* VERYFRONT_API_BASE_URL=https://api.veryfront.com PROXY_MODE=1 deno task start
```

**Common causes**:
- Syntax error in user code → Check the specific file mentioned
- Missing dependency → Check package.json
- esm.sh down → Check https://esm.sh status

---

### Performance Issues

**Symptom**: Timeouts, stuck requests, p99 > 25s

**Check memory pressure**:
```bash
kubectl $KC top pods $NS -l app.kubernetes.io/name=veryfront-renderer
```

**Check for stuck requests**:
```bash
kubectl $KC logs $NS deployment/veryfront-renderer --tail=200 | grep -E "stuck|slow|timeout"
```

**Quick fix**: Restart pods
```bash
kubectl $KC rollout restart deployment/veryfront-renderer $NS
```

---

### Code Issues

**Symptom**: `Cannot read property`, `undefined is not a function`

This is usually a bug in user code or framework code.

**Debug locally with source maps**:
```bash
deno task start --inspect
```

Then open `chrome://inspect` to debug with breakpoints.

---

### Network Issues

**Symptom**: `ECONNREFUSED`, `fetch failed`, `ETIMEDOUT`

**Check API connectivity**:
```bash
kubectl $KC exec $NS deployment/veryfront-renderer -- curl -s http://veryfront-api:80/health
```

**Check external services**:
```bash
# esm.sh
curl -s https://esm.sh/react | head -1

# Redis (if using distributed cache)
kubectl $KC exec $NS deployment/veryfront-renderer -- sh -c 'echo PING | nc $REDIS_HOST 6379'
```

## Debug Endpoints

These only work in dev mode or with debug flag:

| Endpoint | Purpose |
|----------|---------|
| `/_vf_debug/context` | Shows current request context, token, project |
| `/_vf_debug/cache` | Shows cache stats and recent entries |
| `/_vf_debug/transforms` | Shows active transforms and timing |

```bash
curl "http://localhost:8080/_vf_debug/context" | jq
```

## Checklist: 500 Error Investigation

```
[ ] 1. Reproduce locally with production cache
      VERYFRONT_API_BASE_URL=https://api.veryfront.com PROXY_MODE=1 deno task start

[ ] 2. Check error category (cache/transform/perf/code/network)

[ ] 3. Apply category-specific fix

[ ] 4. Verify fix locally

[ ] 5. If cache issue: clear project cache in production

[ ] 6. Monitor for 5 minutes to confirm resolution
```

## Common Pitfalls

| Pitfall | Why It Wastes Time | Better Approach |
|---------|-------------------|-----------------|
| Reading prod logs first | Noisy, truncated, slow | Reproduce locally first |
| Restarting pods immediately | Hides root cause | Get logs before restart |
| Searching for exact error string | Error messages can vary | Search for key patterns |
| Fixing without verifying | May not be the real fix | Always verify locally first |

## Adding Better Error Messages

When you fix an issue, improve the error message for next time:

```typescript
// Bad: Generic error
throw new Error('Module not found');

// Good: Actionable error
throw new Error(
  `Module not found: ${modulePath}\n` +
  `This may be a cache issue. The path suggests ${isProductionPath ? 'production' : 'local'} cache.\n` +
  `Try: curl -X DELETE "https://api.veryfront.com/internal/cache/project/${projectId}/transforms"`
);
```
