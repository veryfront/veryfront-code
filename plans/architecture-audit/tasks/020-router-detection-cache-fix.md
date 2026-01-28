# 020 - Router Detection Cache Fix

## Priority: P3 - MULTI-TENANT

## North Star
Router detection cache isolated per project. No cross-project cache pollution.

## References
- Issue: [005.1-global-router-detection-cache.md](../005.1-global-router-detection-cache.md)
- RFC: [005.0-router-unification-rfc.md](../005.0-router-unification-rfc.md)

## Checklist
- [ ] Add projectId to router detection cache key
- [ ] Key format: `${projectId}:${projectDir}` (not just projectDir)
- [ ] Make `clearRouterDetectionCache(projectId)` project-scoped
- [ ] Add TTL to router detection cache (5 min)
- [ ] Log router detection results with projectId

## Acceptance Criteria
- [ ] Project A's router type doesn't affect Project B
- [ ] API adapter projects (projectDir="") isolated by projectId
- [ ] Cache clear only affects specified project
- [ ] Router type logged per project

## Quality Gates
- [ ] Cache key includes projectId
- [ ] No global cache clear without projectId
- [ ] Tests for cache isolation between projects

## Test Coverage
- [ ] Unit: Same projectDir, different projectId → separate entries
- [ ] Unit: Project-scoped clear only clears that project
- [ ] Integration: Two API projects with different routers
