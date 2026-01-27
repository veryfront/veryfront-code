# 013 - SSR Module Path Consistency

## Priority: P2 - POD DIVERGENCE

## North Star
SSR module paths identical across all pods. No "works on pod A, fails on pod B".

## References
- Issue: [003.1-ssr-module-path-mismatch.md](../003.1-ssr-module-path-mismatch.md)
- RFC: [003.0-cache-consistency-rfc.md](../003.0-cache-consistency-rfc.md)

## Checklist
- [ ] Audit SSR module path generation for pod-specific components
- [ ] Replace absolute paths with content-addressed paths
- [ ] Use `file://${CACHE_DIR}/vf-${contentHash}.mjs` pattern
- [ ] Ensure CACHE_DIR consistent across pods (or use relative)
- [ ] Add path normalization layer
- [ ] Log path mismatches as errors

## Acceptance Criteria
- [ ] Module cached on pod A loadable on pod B
- [ ] No `file://` paths with pod-specific directories
- [ ] Path generation deterministic from content

## Quality Gates
- [ ] `grep -r "file://" src/` shows only content-addressed paths
- [ ] Path includes content hash, not timestamp
- [ ] No `/tmp/` or `/var/` in module paths

## Test Coverage
- [ ] Unit: Same content generates same path
- [ ] Unit: Path contains content hash
- [ ] Integration: Cache on simulated pod A, load on pod B
- [ ] Integration: Module survives pod restart
