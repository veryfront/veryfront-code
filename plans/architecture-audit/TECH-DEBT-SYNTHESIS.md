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

### Current State
- Transform cache keys use only `contentHash`, not dependency hashes
- Infrastructure exists (`depsHash` fields, hash calculators) but disconnected
- RFC exists: `004.0-dependency-tracking-rfc.md`

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

### Recommendation

**Priority: P2 (~14 days effort)**

The existing TTL-based caching and release-based invalidation provide acceptable staleness windows. Full dependency tracking would require:

1. Building dependency graph during transform
2. Computing transitive closure hash
3. Updating all cache key generation sites
4. Handling circular dependencies

**Deferred**: Implement when staleness becomes a reported issue.

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

### Immediate (P1) - DONE
All HIGH/CRITICAL issues resolved.

### Next Sprint (P2) - ~24 days total
| Issue | Effort | ROI |
|-------|--------|-----|
| 011.2-011.5: Import Unification | ~10 days | High - prevents hydration bugs |
| 004: Dependency Tracking | ~14 days | Medium - reduces stale cache |

### Opportunistic (P3) - ~8 days total
| Issue | Effort | ROI |
|-------|--------|-----|
| 010.3: Error Type Rename | ~5 days | Low - code clarity |
| Silent catch cleanup | ~3 days | Low - debugging |

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
├── keys.ts                 # Add depsHash parameter
├── dependency-graph.ts     # Track imports during transform
└── hash-calculator.ts      # Compute transitive closure
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

### Dependency Tracking
- [ ] Cache invalidates when dependency changes
- [ ] Circular dependencies handled
- [ ] Performance impact acceptable
- [ ] TTL fallback still works

---

## References

- [Turbopack Documentation](https://turbo.build/pack/docs)
- [Parcel v2.9.0 Release Notes](https://parceljs.org/blog/v2-9-0/)
- [Salsa - Rust Compiler Guide](https://rustc-dev-guide.rust-lang.org/queries/salsa.html)
- [Vite Plugin API](https://vitejs.dev/guide/api-plugin.html)
- [ES2022 Error Cause](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause)
