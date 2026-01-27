# 008 - React Cache by Version

## Priority: P1 - VERSION MISMATCH

## North Star
React module loaded matches project's specified version. No version conflicts.

## References
- Issue: [002.3-react-cache-version-mismatch.md](../002.3-react-cache-version-mismatch.md)
- RFC: [002.0-request-scoped-state-rfc.md](../002.0-request-scoped-state-rfc.md)

## Checklist
- [ ] Replace global `projectReactCache` with version-keyed Map
- [ ] Replace global `reactDOMServerCache` with version-keyed Map
- [ ] Key format: `react@{version}` (e.g., `react@18.2.0`)
- [ ] Detect project's React version from package.json/import map
- [ ] Load correct version for each project's request
- [ ] Add version to SSR module cache key

## Acceptance Criteria
- [ ] Project with React 18.2 gets 18.2
- [ ] Project with React 18.3 gets 18.3 (concurrent)
- [ ] No "Cannot read property of undefined" from version mismatch
- [ ] Version logged in SSR trace

## Quality Gates
- [ ] `grep "projectReactCache" src/` shows Map<version, module>
- [ ] No global single-value React cache
- [ ] Version in cache key for all React-dependent transforms

## Test Coverage
- [ ] Unit: Different versions load different modules
- [ ] Unit: Same version reuses cached module
- [ ] Integration: React 18.2 project + React 18.3 project concurrent
- [ ] Integration: Hooks work correctly with version-matched React
