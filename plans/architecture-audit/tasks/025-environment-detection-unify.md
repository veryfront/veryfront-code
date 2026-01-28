# 025 - Environment Detection Unification

## Priority: P4 - MAINTENANCE

## North Star
Single pattern for SSR/browser detection. No conflicting detection methods.

## References
- Issues: [006.1](../006.1-ssr-detection-inconsistencies.md), [006.2](../006.2-redundant-runtime-detection.md), [006.3](../006.3-module-loading-conditionals.md)
- RFC: [006.0-environment-detection-rfc.md](../006.0-environment-detection-rfc.md)

## Checklist
- [ ] Create `RenderContext` with `isSSR`, `runtime` properties
- [ ] Replace `typeof window !== "undefined"` checks
- [ ] Replace `globalThis.__VERYFRONT_SSR__` checks
- [ ] Move `isDeno`/`isNode` to platform adapter layer only
- [ ] Remove module-level `const isBrowser` patterns
- [ ] Use request context for SSR detection

## Acceptance Criteria
- [ ] Single SSR detection pattern via RenderContext
- [ ] No `typeof window` in SSR code
- [ ] Runtime detection only in platform layer
- [ ] No hydration mismatches from detection

## Quality Gates
- [ ] `grep -r "typeof window" src/` returns only client code
- [ ] `grep -r "__VERYFRONT_SSR__" src/` returns 0
- [ ] Runtime checks only in `src/platform/`

## Test Coverage
- [ ] Unit: RenderContext.isSSR correct during SSR
- [ ] Unit: RenderContext.isSSR correct during hydration
- [ ] Integration: No hydration mismatch from detection
