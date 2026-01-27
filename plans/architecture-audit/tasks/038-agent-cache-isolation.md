# 038 - Agent Cache Isolation

## Priority: P2 - SECURITY

## North Star
AI agent cache isolated per project. No cross-project response leakage.

## References
- Issue: [013.2-agent-cache-project-isolation.md](../013.2-agent-cache-project-isolation.md)
- RFC: [013.0-cache-key-patterns-rfc.md](../013.0-cache-key-patterns-rfc.md)

## Checklist
- [ ] Add projectId to agent cache key generator
- [ ] Key format: `cache_${projectId}_${inputHash}`
- [ ] Inject projectId from request context
- [ ] Add cache isolation test
- [ ] Document agent cache key format

## Acceptance Criteria
- [ ] Same prompt, different projects → separate cache
- [ ] Project A response never returned for Project B
- [ ] Cache key includes projectId

## Quality Gates
- [ ] Agent cache key includes projectId
- [ ] Security test: cross-project cache miss
- [ ] No global cache without project scope

## Test Coverage
- [ ] Unit: Key includes projectId
- [ ] Unit: Same input, different projects → different keys
- [ ] Security: Cross-project cache access returns miss
