# 027 - Cache Key Standard

## Priority: P1 - CONSISTENCY

## North Star
All cache keys follow same format. No format guessing or inconsistency.

## References
- Issue: [013.3-key-format-standardization.md](../013.3-key-format-standardization.md)
- RFC: [013.0-cache-key-patterns-rfc.md](../013.0-cache-key-patterns-rfc.md)

## Standard Format

```
v{version}:{type}:{scope}:{identifier}:{hash}
```

| Component | Required | Example |
|-----------|----------|---------|
| version | Yes | `v18` |
| type | Yes | `transform`, `render`, `module` |
| scope | If identity-based | `proj-123` |
| identifier | Yes | `pages/index.tsx`, `ssr` |
| hash | Yes | `abc123` (content hash) |

**Examples:**
```
v18:transform:pages/index.tsx:abc123:browser
v18:render:proj-123:/about:def456
v18:module:https://esm.sh/react@18.2.0:ghi789
```

## Checklist
- [ ] Create `buildCacheKey(type, scope?, id, hash, ...tags)` helper
- [ ] Migrate all cache key generation to use helper
- [ ] Standardize separator (`:` everywhere, not `::` or `-`)
- [ ] Add version prefix to all cache keys
- [ ] Add content hash to all cache keys

## Acceptance Criteria
- [ ] All cache keys parseable with same regex
- [ ] Version extractable from any key
- [ ] Type extractable from any key
- [ ] No ad-hoc cache key string building

## Quality Gates
- [ ] Single `buildCacheKey` function used everywhere
- [ ] No string concatenation for cache keys
- [ ] Key format documented and validated

## Test Coverage
- [ ] Unit: Key format matches standard
- [ ] Unit: All required components present
- [ ] Audit: Grep for non-standard key patterns
