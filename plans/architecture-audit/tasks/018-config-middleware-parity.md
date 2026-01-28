# 018 - Config & Middleware Loading Parity

## Priority: P3 - ADAPTER DIVERGENCE

## North Star
Config and middleware load identically regardless of adapter.

## References
- Issue: [001.5-config-middleware-loading-divergence.md](../001.5-config-middleware-loading-divergence.md)
- RFC: [001.0-unified-adapter-rfc.md](../001.0-unified-adapter-rfc.md)
- Depends: Task 016

## Checklist
- [ ] Create `loadConfig(adapter, projectDir)` function
- [ ] Create `loadMiddleware(adapter, projectDir)` function
- [ ] Remove adapter-specific config loading paths
- [ ] Use `adapter.readFile()` for all config reads
- [ ] Normalize config paths (veryfront.config.ts, .js, .mjs)
- [ ] Handle missing config gracefully (same behavior all adapters)

## Acceptance Criteria
- [ ] Config loads via Local, API, GitHub adapters identically
- [ ] Middleware.ts discovered via all adapters
- [ ] Missing config returns same default for all adapters
- [ ] No `if (isLocal)` in config loading

## Quality Gates
- [ ] Single config loading function
- [ ] Single middleware loading function
- [ ] Tests pass for all adapters

## Test Coverage
- [ ] Unit: Load config via each adapter
- [ ] Unit: Load middleware via each adapter
- [ ] Unit: Missing config returns default
- [ ] Conformance: Same config loads same values via all adapters
