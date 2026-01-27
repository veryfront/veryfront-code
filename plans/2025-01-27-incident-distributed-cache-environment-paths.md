# Incident: Distributed Cache Environment-Specific Paths

**Date**: 2025-01-27
**Status**: In Progress
**Severity**: P1 (Production 500 errors)
**Affected Service**: veryfront-renderer
**Affected Site**: codersociety.com

## Summary

Production 500 error caused by distributed cache (Redis/API) storing transformed code with environment-specific absolute file:// paths. When Pod B retrieves code cached by Pod A (or production vs local), the file:// paths point to non-existent locations.

## Error Message

```
Failed to import MDX page via ESM: Invalid or unexpected token
Module not found "file:///app/src/react/router/index.ts"
```

## Root Cause Analysis

The distributed transform cache stores pre-transformed JavaScript code for cross-pod sharing. This code contains absolute `file://` paths to:

1. **Framework source files**: `file:///app/src/react/router/index.ts` (production) vs `file:///Users/.../veryfront-renderer/src/react/router/index.ts` (local)

2. **HTTP bundle cache**: `file:///app/.cache/veryfront-http-bundle/http-974671618.mjs` (production) vs `file:///Users/.../.cache/veryfront-http-bundle/http-974671618.mjs` (local)

3. **MDX ESM cache**: `file:///app/.cache/veryfront-mdx-esm/vfmod-*.mjs` paths

These paths are derived from `FRAMEWORK_ROOT` (computed from `import.meta.url`) which varies by environment.

## Timeline

- **Initial Detection**: 500 error on codersociety.com in production
- **Root Cause Identified**: Distributed cache contains production paths that don't exist locally (or vice versa)
- **Fix Implementation**: Added path validation and cache invalidation logic

## Technical Details

### Affected Files

1. `/src/transforms/mdx/esm-module-loader/module-fetcher/index.ts`
   - Added `hasIncompatibleFrameworkPaths()` to detect environment-specific paths
   - Added validation before using distributed cache hits
   - Invalidates local filesystem cache if paths are incompatible

2. `/src/transforms/esm/http-cache.ts`
   - Added `hasIncompatibleFilePaths()` to detect HTTP bundle paths from different environments
   - Added validation in `cacheHttpModule()`, `recoverHttpBundleByHash()`, and `ensureHttpBundlesExist()`

### Path Types Validated

| Path Type | Pattern | Example |
|-----------|---------|---------|
| Framework Source | `/src/` (not in .cache) | `file:///app/src/react/router/index.ts` |
| HTTP Bundle | `veryfront-http-bundle/http-*.mjs` | `file:///app/.cache/veryfront-http-bundle/http-974671618.mjs` |
| MDX ESM | `veryfront-mdx-esm/vfmod-*.mjs` | `file:///app/.cache/veryfront-mdx-esm/vfmod-v3-123.mjs` |

### Detection Logic

```typescript
function hasIncompatibleFrameworkPaths(code: string): boolean {
  // Extract all file:// paths from code
  // For each path:
  //   - If HTTP bundle path: must start with local getHttpBundleCacheDir()
  //   - If MDX cache path: must start with local getMdxEsmCacheDir()
  //   - If framework source path: must start with FRAMEWORK_ROOT
  // Return true if any path is incompatible
}
```

### Recovery Strategies

When incompatible paths are detected:

1. **HTTP Bundles**: Falls back to re-fetch from network via URL lookup (`hash:{hash}` → URL → fetch)
2. **MDX Transforms**: Invalidates cache and re-transforms from source
3. **Framework Sources**: Re-transforms to generate correct local paths

## Current Status

### What's Working

- Detection of incompatible file:// paths in cached code ✓
- HTTP bundle recovery via direct code lookup (`code:{hash}`) ✓
- HTTP bundle recovery via URL re-fetch (when URL mapping exists) ✓
- Most bundles (203+) are being recovered successfully ✓

### Remaining Issue

Some HTTP bundles fail to recover because:
1. Cached code has incompatible paths (correctly detected)
2. Falls through to URL re-fetch strategy
3. URL mapping (`hash:{hash}` → URL) is missing from distributed cache
4. Bundle cannot be recovered, causing import failure

Example:
```
[HTTP-CACHE] No recovery data found for hash
hash=559455871
[HTTP-CACHE] Some bundles could not be recovered
failed=["559455871"]
```

### Hypothesis

The URL mapping may be missing because:
- Bundle was cached before `hash:{hash}` key was added
- Cache entry expired (24h TTL) but code entry still exists
- Race condition during initial caching

## Proposed Additional Fixes

1. **Clear stale distributed cache entries**: Remove v1 cache entries that don't have URL mappings
2. **Add fallback URL reconstruction**: For esm.sh bundles, reconstruct URL from hash if possible
3. **Invalidate entire bundle chain**: If any bundle in a chain fails, invalidate the root transform

## Reproduction Steps

1. Start local server with production API cache:
   ```bash
   VERYFRONT_API_BASE_URL=https://api.veryfront.com PROXY_MODE=1 deno task start
   ```

2. Visit `http://codersociety.veryfront.me:8080/`

3. Observe 500 error due to Module not found

## Mitigation

Short-term:
- Clear distributed cache for affected project
- Redeploy pods to force re-caching with correct paths

Long-term:
- Deploy fix that validates paths before using cached code
- Add monitoring for cache incompatibility warnings

## Related

- Cache version: `HTTP_BUNDLE_VERSION = 2` (incremented to invalidate gzip-polluted cache)
- Transform cache version: `TRANSFORM_CACHE_VERSION` in package-registry.ts
