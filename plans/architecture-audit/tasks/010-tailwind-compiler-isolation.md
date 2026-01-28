# 010 - Tailwind Compiler State Isolation

## Priority: P1 - CONFIG LEAKAGE

## North Star
Tailwind compiler state (plugins, config) isolated per project.

## References
- Issue: [002.8-tailwind-compiler-state.md](../002.8-tailwind-compiler-state.md)
- RFC: [002.0-request-scoped-state-rfc.md](../002.0-request-scoped-state-rfc.md)

## Checklist
- [ ] Replace global `compiler` with per-project Map
- [ ] Replace global `pluginCache` with per-project Map
- [ ] Replace global `pluginErrors` with per-project Map
- [ ] Key by projectId + tailwind config hash
- [ ] Add TTL/LRU eviction (max 50 projects cached)
- [ ] Clear project's compiler on config change

## Acceptance Criteria
- [ ] Project A's Tailwind plugins don't affect Project B
- [ ] Custom theme in Project A not visible in Project B
- [ ] Compiler reused for same project (performance)
- [ ] Memory bounded by LRU eviction

## Quality Gates
- [ ] No global `compiler` variable
- [ ] Config hash in cache key
- [ ] Memory stable with many projects

## Test Coverage
- [ ] Unit: Different configs get different compilers
- [ ] Unit: Same config reuses compiler
- [ ] Unit: LRU eviction works
- [ ] Integration: Custom plugin in Project A, default in Project B
