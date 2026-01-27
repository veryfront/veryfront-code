# 019 - CSS Cache Key Fix

## Priority: P3 - CACHE DIVERGENCE

## North Star
CSS cache keys identical across adapters. No adapter-specific cache keys.

## References
- Issue: [001.6-css-cache-key-divergence.md](../001.6-css-cache-key-divergence.md)
- RFC: [001.0-unified-adapter-rfc.md](../001.0-unified-adapter-rfc.md)

## Checklist
- [ ] Audit CSS cache key generation
- [ ] Remove adapter type from cache key
- [ ] Use content hash + config hash only
- [ ] Ensure same CSS content → same cache key across adapters
- [ ] Add projectId to cache key (but not adapter type)

## Acceptance Criteria
- [ ] Same CSS generates same cache key via Local vs API
- [ ] CSS cached via Local usable when switching to API
- [ ] No `adapterType` in CSS cache keys

## Quality Gates
- [ ] CSS cache keys don't contain adapter identifier
- [ ] Cache key generation tested for all adapters
- [ ] Same CSS file produces same key across adapters

## Test Coverage
- [ ] Unit: Same CSS → same key (Local)
- [ ] Unit: Same CSS → same key (API)
- [ ] Unit: Same CSS → same key (GitHub)
- [ ] Integration: CSS cached via Local, hit via API
