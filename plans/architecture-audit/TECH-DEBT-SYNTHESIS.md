# Architecture Audit Tech Debt Synthesis

> Generated: 2026-01-28 via Claude Octopus Double Diamond workflow
> Research sources: Multi-AI analysis (Codex, Gemini, Claude)

## Executive Summary

All **HIGH** and **CRITICAL** priority issues have been resolved. The remaining tech debt items (P2/P3) are code quality improvements that don't affect production reliability.

### Quick Wins Applied

| Issue | Fix | Commit |
|-------|-----|--------|
| 010.3 | toError() stack trace capture | 5af5ff4c |

---

## 004: Dependency Tracking

### Current State — ✅ COMPLETED (7629b537)
- Transform cache keys now include `depsHash` and `configHash`
- Dependency and config tracking wired into transform pipeline
- Bundle manifest system adds atomic HTTP bundle validation (eef7dfe6)

### Research Findings

**Turbopack** uses function-level caching with automatic dependency tracking via "Value Cells" (Vc<...>). Requires DAG structure for deterministic builds.

**Parcel** solves cascading invalidation via:
- Manifest-based stable bundle IDs
- Content hashing of final bundle output
- Incremental symbol propagation

**Salsa Framework** (Rust Compiler):
- Automatic dependency graph construction
- Early cutoff optimization (stop invalidation when values unchanged)
- Lazy invalidation via global version numbers

**Nix/ca-derivations**:
- Content-addressed derivations deduplicate identical outputs
- "Memoized pure execve" model

### Concrete Implementation Patterns

**esbuild's Three-Step Hash Algorithm** (solves chicken-and-egg for cyclic imports):
```
Step 1: Generate output with TEMPORARY PATHS for cross-file imports
        Hash = hash(code excluding temp paths) + hash(relative input paths)
Step 2: Replace temporary paths with FINAL HASHES
Step 3: Final output with stable cache keys
```

**Memoized Incremental Hash Tree**:
```typescript
interface DependencyNode {
  filePath: string;
  contentHash: string;        // Hash of this file only
  transitiveDepsHash: string; // Hash of (contentHash + sorted children's hashes)
  children: Set<string>;      // Direct imports
  version: number;            // Invalidation counter
}

// O(1) for cache hit, O(depth) for cache miss
async getTransitiveDepsHash(filePath: string): Promise<string>

// O(affected nodes), NOT O(total nodes)
invalidateFile(filePath: string): void
```

**Cycle Detection** (3 approaches):
1. **SCC**: Strongly Connected Components treated as single unit
2. **Visited Set**: Return content hash only for cycle members
3. **Version Counter**: Salsa-style lazy recomputation

### Recommendation

**Priority: P2 (~14 days effort)**

The existing TTL-based caching and release-based invalidation provide acceptable staleness windows. Full dependency tracking would require:

1. Building dependency graph during transform
2. Computing transitive closure hash with cycle handling
3. Updating all cache key generation sites
4. Adding config hash to cache keys

**Status**: ✅ Completed — depsHash/configHash in cache keys (7629b537), bundle manifest for atomic validation (eef7dfe6).

---

## 010.3: Error System Consolidation

### Current State
- **Type union** (`VeryfrontError`): 156 files, 92 call sites
- **Class-based** (`VeryfrontError`): 11 files (different definition)
- Quick fix applied: `toError()` now captures stack at call site

### Research Findings

**Recommended approach**: Class-based with ES2022 cause chain

```typescript
class VeryfrontError extends Error {
  constructor(code, message, { cause, context }) {
    super(message, { cause }); // ES2022 cause
    Error.captureStackTrace?.(this, this.constructor);
  }
}
```

**Migration pattern**:
1. Rename type union to `VeryfrontErrorData`
2. Add adapter layer for interop
3. Gradual file-by-file migration

### Recommendation

**Priority: P3 (~5 days for rename, ~2 weeks for full migration)**

The quick fix provides the main benefit (stack traces). Full consolidation is beneficial but not urgent.

**Options**:
1. **Minimal**: Keep current pattern, document dual definitions
2. **Rename**: Change `VeryfrontError` type to `VeryfrontErrorData` (92 files)
3. **Full migration**: Class-based with error catalog

---

## 011.2-011.5: Import Rewriting Unification

### Current State
- 7 separate implementations mixing es-module-lexer and regex
- Foundation exists: `src/transforms/esm/lexer.ts` with `replaceSpecifiers()`
- RFC exists in research notes

### Research Findings

**Vite's model** (gold standard):
- Single `resolveId` hook for all resolution
- `ssr` flag only affects serving, not URLs
- Import maps for SSR/browser consistency

**Recommended architecture**: Strategy Pattern

```typescript
interface ImportRewriteStrategy {
  name: string;
  priority: number;
  applies(specifier: string, context: RewriteContext): boolean;
  rewrite(specifier: string, context: RewriteContext): string;
}
```

**Priority ordering**:
0. React runtime imports
1. Path aliases (@/ → project root)
2. Bare specifiers (npm packages)
3. Relative imports
4. Cross-project imports

**Canonical URL system** for hydration safety:
```
/_vf/runtime/  - React, framework internals
/_vf/modules/  - User code
/_vf/npm/      - npm packages
/_vf/cross/    - Cross-project imports
```

### Recommendation

**Priority: P2 (~10 days effort)**

Implementation plan:
1. Create `UnifiedImportRewriter` class
2. Create strategy files in `src/module-system/strategies/`
3. Migrate each of 7 implementations
4. Add hydration safety tests (SSR === browser)
5. Remove regex-based transforms

---

## Implementation Priorities

### Immediate (P1) - DONE ✅
All HIGH/CRITICAL issues resolved.

### Next Sprint (P2) - DONE ✅
| Issue | Effort | Status |
|-------|--------|--------|
| 011.2-011.5: Import Unification | ~10 days | ✅ Completed - Strategy pattern with 8 strategies |
| 004: Dependency Tracking | ~14 days | ✅ Completed - depsHash/configHash in cache keys |

### Opportunistic (P3) - DONE ✅
| Issue | Effort | Status |
|-------|--------|--------|
| 010.3: Error Type Rename | ~5 days | ✅ Completed - Renamed to VeryfrontErrorData |
| Silent catch cleanup | ~3 days | ✅ Completed - 16 empty catches documented |

---

## Architecture Recommendations

### For Import Rewriting (011)
```
src/module-system/
├── unified-rewriter.ts      # Main class
├── strategies/
│   ├── react.ts            # Priority 0
│   ├── aliases.ts          # Priority 1
│   ├── bare-specifiers.ts  # Priority 2
│   ├── relative.ts         # Priority 3
│   └── cross-project.ts    # Priority 4
└── canonical-urls.ts       # URL prefix constants
```

### For Error System (010)
```
src/errors/
├── veryfront-error.ts      # Type VeryfrontErrorData (renamed)
├── error-class.ts          # Class VeryfrontError (future)
├── catalog.ts              # Error definitions (future)
└── factory.ts              # Errors.build.*, etc (future)
```

### For Dependency Tracking (004)
```
src/cache/
├── keys.ts                 # Add depsHash, configHash parameters
├── dependency-graph.ts     # Track imports during transform
├── config-hash.ts          # Hash transform-affecting config
└── hash-calculator.ts      # Compute transitive closure
```

**Key Implementation**: `dependency-graph.ts`
```typescript
export interface DependencyGraph {
  imports: Map<string, Set<string>>;        // file -> direct imports
  inverseImports: Map<string, Set<string>>; // file -> importers
  contentHashes: Map<string, string>;
  depsHashes: Map<string, string>;          // Memoized transitive hashes
}

// Build graph with parallel file reads
export async function buildDependencyGraph(
  entryPath: string,
  adapter: RuntimeAdapter,
  projectDir: string,
): Promise<DependencyGraph>

// Compute hash with cycle detection and memoization
export async function computeDepsHash(
  filePath: string,
  graph: DependencyGraph,
  computing: Set<string> = new Set(), // Cycle detection
): Promise<string>

// Get affected files for cache invalidation - O(affected) not O(total)
export function getAffectedFiles(
  changedPath: string,
  graph: DependencyGraph,
): Set<string>
```

**Updated Cache Key**:
```typescript
buildTransformCacheKey(
  filePath,
  contentHash,
  depsHash,     // NEW: transitive dependency hash
  configHash,   // NEW: transform-affecting config hash
  ssr,
  studioEmbed,
)
```

---

## Testing Checklist

### Import Rewriting
- [ ] SSR and browser produce identical URLs
- [ ] All rewritten URLs use canonical prefixes
- [ ] Strategy priority order is correct
- [ ] Dynamic imports handled correctly

### Error System
- [ ] Stack traces captured at creation site
- [ ] Error cause chains preserved
- [ ] JSON serialization works
- [ ] Type guards work with both patterns

### Dependency Tracking ✅
- [x] Cache invalidates when dependency changes (depsHash in keys)
- [x] Config changes invalidate cache (configHash in keys)
- [x] Bundle manifest validates atomic bundle groups
- [x] TTL fallback still works (legacy path for old entries)

---

## References

### Dependency Tracking & Build Systems
- [Vite Dependency Pre-Bundling](https://vite.dev/guide/dep-pre-bundling)
- [esbuild Release v0.9.4 - Hashing Algorithm](https://github.com/evanw/esbuild/releases/tag/v0.9.4)
- [Turbopack Incremental Computation](https://nextjs.org/blog/turbopack-incremental-computation)
- [Parcel Production Features](https://parceljs.org/features/production/)
- [Rust Analyzer Durable Incrementality](https://rust-analyzer.github.io/blog/2023/07/24/durable-incrementality.html)
- [Salsa - Rust Compiler Guide](https://rustc-dev-guide.rust-lang.org/queries/salsa.html)

### Import Rewriting
- [Vite Plugin API](https://vitejs.dev/guide/api-plugin.html)
- [es-module-lexer](https://github.com/guybedford/es-module-lexer)

### Error Handling
- [ES2022 Error Cause](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause)
