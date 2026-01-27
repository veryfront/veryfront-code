# 005 - Runtime Config Isolation

## Priority: P0 - DATA LEAKAGE

## North Star
Runtime config is request-scoped. No global singleton.

## References
- Issue: [007.7-runtime-config-global-singleton.md](../007.7-runtime-config-global-singleton.md)
- RFC: [007.0-config-normalization-rfc.md](../007.0-config-normalization-rfc.md)
- Depends: Task 002

## Checklist
- [ ] Remove global `let runtimeConfig` singleton
- [ ] Add `runtimeConfig` to RequestContext interface
- [ ] Update `getRuntimeConfig()` to use context
- [ ] Remove `initRuntimeConfig()` (set via context instead)
- [ ] Remove `updateRuntimeConfig()` (immutable per request)
- [ ] Audit all `getRuntimeConfig()` callers for context availability

## Acceptance Criteria
- [ ] Project A config never returned for Project B request
- [ ] `getRuntimeConfig()` throws outside request context
- [ ] No global mutable state in runtime-config.ts

## Quality Gates
- [ ] `grep "let runtimeConfig" src/config/` returns nothing
- [ ] No `updateRuntimeConfig` exports
- [ ] All config access via context or explicit parameter

## Test Coverage
- [ ] Unit: Config throws outside context
- [ ] Unit: Concurrent requests get correct configs
- [ ] Integration: Project A title vs Project B title
- [ ] Integration: Feature flags isolated per project
