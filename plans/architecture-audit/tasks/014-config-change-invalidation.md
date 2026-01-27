# 014 - Config Change Cache Invalidation

## Priority: P2 - STALE CONFIG

## North Star
Config change invalidates all dependent caches. No stale config in cached transforms.

## References
- Issues: [008.4-hmr-cache-invalidation-incomplete.md](../008.4-hmr-cache-invalidation-incomplete.md), [004.6-config-changes-not-invalidating.md](../004.6-config-changes-not-invalidating.md)
- RFC: [008.0-userland-config-rfc.md](../008.0-userland-config-rfc.md)

## Checklist
- [ ] Add config hash to transform cache keys
- [ ] Track config-dependent caches (transform, Tailwind, SSR)
- [ ] On config change, invalidate all dependent caches
- [ ] Make `clearConfigCache(projectId)` project-scoped
- [ ] Trigger HMR reload on config change
- [ ] Log cache invalidation events

## Acceptance Criteria
- [ ] Change `veryfront.config.ts` → transforms rebuild
- [ ] Change Tailwind config → CSS regenerates
- [ ] HMR triggers browser reload on config change
- [ ] Only affected project's caches cleared

## Quality Gates
- [ ] Config hash in all config-dependent cache keys
- [ ] No global cache clear (always project-scoped)
- [ ] Invalidation logged with reason

## Test Coverage
- [ ] Unit: Config hash changes → cache miss
- [ ] Unit: Config unchanged → cache hit
- [ ] Integration: Edit config, verify transform rebuilds
- [ ] Integration: Edit config, verify HMR triggers
