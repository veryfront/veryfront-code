# 011 - Transform Cache Dependency Hash

## Priority: P2 - STALE DATA

## North Star
Transform cache invalidates when any dependency changes, not just the main file.

## References
- Issues: [004.1-transform-cache-no-deps-hash.md](../004.1-transform-cache-no-deps-hash.md), [004.2-unused-depshash-infrastructure.md](../004.2-unused-depshash-infrastructure.md)
- RFC: [004.0-dependency-tracking-rfc.md](../004.0-dependency-tracking-rfc.md)

## Checklist
- [ ] Build import graph during transform (parse imports)
- [ ] Compute stable hash of all transitive dependencies
- [ ] Add `depsHash` to `buildTransformCacheKey()` signature
- [ ] Wire up existing `computeDepsHash()` to cache key generation
- [ ] Set `depsHash` in BundleMetadata (currently undefined)
- [ ] Build inverse dependency index for targeted invalidation

## Acceptance Criteria
- [ ] Update `helper.ts` → all importers cache miss
- [ ] Update `Button.tsx` → all pages using Button cache miss
- [ ] Same file, same deps → cache hit
- [ ] No "clear cache to see changes" workarounds

## Quality Gates
- [ ] `depsHash` always present in cache key (not optional)
- [ ] Dependency graph computed in single parse pass
- [ ] Cache key deterministic (same deps = same hash)

## Test Coverage
- [ ] Unit: Import graph extraction
- [ ] Unit: Hash changes when dep changes
- [ ] Unit: Hash stable when deps unchanged
- [ ] Integration: Change shared component, verify page rebuilds
- [ ] Integration: Change utility, verify all importers rebuild
