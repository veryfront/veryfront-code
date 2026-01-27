# 026 - Unified Caching Strategy

## Priority: P0 - FOUNDATION

## North Star
Single caching pattern across all systems. Clear rules for what's cacheable and how.

## References
- RFC: [003.0-cache-consistency-rfc.md](../003.0-cache-consistency-rfc.md)
- RFC: [013.0-cache-key-patterns-rfc.md](../013.0-cache-key-patterns-rfc.md)

## Caching Rules

### Content-Addressed (Safe to Share)
Same input = same output. No projectId needed.
- Transform cache (code in, code out)
- HTTP module cache (URL → file)
- MDX compile cache (source → bundle)

### Identity-Based (Must Isolate)
Output depends on context. ProjectId required.
- Render cache (page + project context)
- Data fetch cache (API + project token)
- Layout cache (path + project structure)
- Config cache (project config)

### Never Cache
- Request-scoped state (head collector, SSR context)
- Error state (failed components - TTL only)
- Semaphore state

## Checklist
- [ ] Document caching rules in `src/cache/README.md`
- [ ] Add `CacheType` enum: `CONTENT_ADDRESSED | IDENTITY_BASED`
- [ ] Audit all caches for correct categorization
- [ ] Add lint rule: cache key must match cache type
- [ ] Add `projectId` assertion for identity-based caches

## Acceptance Criteria
- [ ] All caches categorized as content-addressed or identity-based
- [ ] Content-addressed caches work cross-project (intentional)
- [ ] Identity-based caches isolated per project
- [ ] Developer docs explain which to use when

## Quality Gates
- [ ] All new caches must specify type
- [ ] Code review checklist includes cache type validation
- [ ] No "unclear" cache categorization

## Test Coverage
- [ ] Audit: Every cache has correct type
- [ ] Integration: Content-addressed cache shared correctly
- [ ] Integration: Identity cache isolated correctly
