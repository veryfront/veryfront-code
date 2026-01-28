# 036 - Dependency Tracking Complete

## Priority: P2 - STALE DATA

## North Star
All dependency types tracked. No stale bundles from any dependency change.

## References
- Issues: [004.2](../004.2-unused-depshash-infrastructure.md), [004.3](../004.3-mdx-import-tracking-gap.md), [004.4](../004.4-npm-esm-package-version-drift.md), [004.5](../004.5-ssr-module-loader-staleness.md)
- RFC: [004.0-dependency-tracking-rfc.md](../004.0-dependency-tracking-rfc.md)

## Status: COMPLETE

### Completed
- [x] Wire up existing `computeDepsHash()` infrastructure → transform pipeline now computes depsHash
- [x] Wire up `computeConfigHash()` → config changes invalidate transforms
- [x] `readFile` auto-extracted from adapter in `transformToESM()` → zero caller changes needed
- [x] Unit tests for dependency hash invalidation (14 test steps passing)
- [x] Backward compatible: new hash params are optional
- [x] MDX imports tracked via transform pipeline (MDX compiled output goes through `transformToESM`)
- [x] npm package versions tracked via `configHash` (includes REACT, TAILWIND, CSSTYPE versions)
- [x] Config hash wired into SSR module loader cache via `computeConfigHashSync()`
- [x] Inverse dependency index built into `DependencyGraph` class (`dependents` map + `getDependents()`)

## Dependency Types to Track
1. ✅ Local imports (`./component`) — tracked via `computeDepsHash`
2. ✅ MDX imports (frontmatter, components) — tracked via transform pipeline (MDX compiled output → `transformToESM`)
3. ✅ npm package versions (esm.sh URLs) — tracked via `configHash` (includes DEFAULT_REACT_VERSION, TAILWIND_VERSION, CSSTYPE_VERSION)
4. ✅ SSR module cache deps — SSR module loader now includes `configHash` in cache key
5. ✅ Config file changes — tracked via `computeConfigHash`

## Checklist
- [x] Wire up existing `computeDepsHash()` infrastructure
- [x] Track MDX imports in dependency graph
- [x] Include npm versions in cache key (via configHash)
- [x] Add config hash to SSR module cache
- [x] Build inverse dependency index for invalidation

## Acceptance Criteria
- [x] Change local import → cache miss
- [x] Change MDX import → cache miss (via transform pipeline depsHash)
- [x] npm version bump → cache miss (via configHash including version constants)
- [x] Config change → cache miss (transform pipeline)
- [x] Config change → SSR cache miss (SSR module loader)

## Quality Gates
- [x] All dependency types in hash
- [x] Inverse index enables targeted invalidation (DependencyGraph.getDependents())
- [x] No manual cache clear needed

## Test Coverage
- [x] Unit: Local import change detected (`dependency-tracking.test.ts`)
- [x] Unit: Transitive dependency change detected
- [x] Unit: Unrelated file change does not invalidate
- [x] Unit: Config hash changes with config
- [x] Unit: Cache key includes depsHash and configHash
- [x] Unit: Backward compatible without dependency tracking

## Implementation Details

### Files Modified
- `src/transforms/pipeline/types.ts` — Added `readFile` to `TransformOptions`
- `src/transforms/pipeline/index.ts` — Compute `configHash` + `depsHash`, pass to cache key; `extractReadFile()` auto-extracts from adapter
- `src/cache/dependency-tracking.test.ts` — New test file (14 test steps)
- `src/cache/config-hash.ts` — Includes npm package version constants in configHash
- `src/modules/react-loader/ssr-module-loader/loader.ts` — Added `computeConfigHashSync` to SSR cache key via lazy `getConfigHash()`

### Architecture
```
Transform Pipeline Cache:
transformToESM(source, filePath, projectDir, adapter, options)
  └── extractReadFile(adapter)    ← auto-extract fs.readFile from adapter
  └── runPipeline(source, filePath, projectDir, enrichedOptions)
        ├── computeConfigHash()   ← cheap, no I/O (includes npm versions)
        ├── computeDepsHash()     ← builds import graph, reads dep files
        └── generateCacheKey(..., { depsHash, configHash, projectId })

SSR Module Cache:
SSRModuleLoader.getCacheKey(filePath)
  └── getConfigHash()             ← lazy computeConfigHashSync (reactVersion, dev)
  └── buildSSRModuleCacheKey(version, projectId, contentSourceId:reactVersion:configHash:filePath)

Inverse Dependency Index:
DependencyGraph
  ├── dependencies: Map<filePath, Set<deps>>     ← forward graph
  └── dependents: Map<filePath, Set<dependents>> ← inverse index
      └── getDependents(filePath): string[]       ← transitive reverse lookup
```
