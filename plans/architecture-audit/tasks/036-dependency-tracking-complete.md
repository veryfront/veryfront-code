# 036 - Dependency Tracking Complete

## Priority: P2 - STALE DATA

## North Star
All dependency types tracked. No stale bundles from any dependency change.

## References
- Issues: [004.2](../004.2-unused-depshash-infrastructure.md), [004.3](../004.3-mdx-import-tracking-gap.md), [004.4](../004.4-npm-esm-package-version-drift.md), [004.5](../004.5-ssr-module-loader-staleness.md)
- RFC: [004.0-dependency-tracking-rfc.md](../004.0-dependency-tracking-rfc.md)

## Status: PARTIALLY COMPLETE

### Completed
- [x] Wire up existing `computeDepsHash()` infrastructure → transform pipeline now computes depsHash
- [x] Wire up `computeConfigHash()` → config changes invalidate transforms
- [x] `readFile` auto-extracted from adapter in `transformToESM()` → zero caller changes needed
- [x] Unit tests for dependency hash invalidation (14 test steps passing)
- [x] Backward compatible: new hash params are optional

### Remaining
- [ ] Track MDX imports in dependency graph
- [ ] Include npm versions in cache key (extract from URL)
- [ ] Add config hash to SSR module cache (separate from transform pipeline)
- [ ] Build inverse dependency index for targeted invalidation

## Dependency Types to Track
1. ✅ Local imports (`./component`) — tracked via `computeDepsHash`
2. ⬜ MDX imports (frontmatter, components) — needs MDX-specific extraction
3. ⬜ npm package versions (esm.sh URLs) — needs URL version extraction
4. ⬜ SSR module cache deps — needs SSR module loader update
5. ✅ Config file changes — tracked via `computeConfigHash`

## Checklist
- [x] Wire up existing `computeDepsHash()` infrastructure
- [ ] Track MDX imports in dependency graph
- [ ] Include npm versions in cache key (extract from URL)
- [ ] Add config hash to SSR module cache
- [ ] Build inverse dependency index for invalidation

## Acceptance Criteria
- [x] Change local import → cache miss
- [ ] Change MDX import → cache miss
- [ ] npm version bump → cache miss
- [x] Config change → cache miss (transform pipeline)
- [ ] Config change → SSR cache miss (SSR module loader)

## Quality Gates
- [ ] All dependency types in hash
- [ ] Inverse index enables targeted invalidation
- [ ] No manual cache clear needed

## Test Coverage
- [x] Unit: Local import change detected (`dependency-tracking.test.ts`)
- [x] Unit: Transitive dependency change detected
- [x] Unit: Unrelated file change does not invalidate
- [x] Unit: Config hash changes with config
- [x] Unit: Cache key includes depsHash and configHash
- [x] Unit: Backward compatible without dependency tracking
- [ ] Unit: MDX import change detected
- [ ] Unit: npm version change detected
- [ ] Integration: Full dependency chain invalidation

## Implementation Details

### Files Modified
- `src/transforms/pipeline/types.ts` — Added `readFile` to `TransformOptions`
- `src/transforms/pipeline/index.ts` — Compute `configHash` + `depsHash`, pass to cache key; `extractReadFile()` auto-extracts from adapter
- `src/cache/dependency-tracking.test.ts` — New test file (14 test steps)

### Architecture
```
transformToESM(source, filePath, projectDir, adapter, options)
  └── extractReadFile(adapter)    ← auto-extract fs.readFile from adapter
  └── runPipeline(source, filePath, projectDir, enrichedOptions)
        ├── computeConfigHash()   ← cheap, no I/O
        ├── computeDepsHash()     ← builds import graph, reads dep files
        └── generateCacheKey(..., { depsHash, configHash, projectId })
```
