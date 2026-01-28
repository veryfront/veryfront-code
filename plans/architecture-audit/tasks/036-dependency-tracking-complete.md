# 036 - Dependency Tracking Complete

## Priority: P2 - STALE DATA

## North Star
All dependency types tracked. No stale bundles from any dependency change.

## References
- Issues: [004.2](../004.2-unused-depshash-infrastructure.md), [004.3](../004.3-mdx-import-tracking-gap.md), [004.4](../004.4-npm-esm-package-version-drift.md), [004.5](../004.5-ssr-module-loader-staleness.md)
- RFC: [004.0-dependency-tracking-rfc.md](../004.0-dependency-tracking-rfc.md)

## Dependency Types to Track
1. Local imports (`./component`)
2. MDX imports (frontmatter, components)
3. npm package versions (esm.sh URLs)
4. SSR module cache deps
5. Config file changes

## Checklist
- [ ] Wire up existing `computeDepsHash()` infrastructure
- [ ] Track MDX imports in dependency graph
- [ ] Include npm versions in cache key (extract from URL)
- [ ] Add config hash to SSR module cache
- [ ] Build inverse dependency index for invalidation

## Acceptance Criteria
- [ ] Change local import → cache miss
- [ ] Change MDX import → cache miss
- [ ] npm version bump → cache miss
- [ ] Config change → SSR cache miss

## Quality Gates
- [ ] All dependency types in hash
- [ ] Inverse index enables targeted invalidation
- [ ] No manual cache clear needed

## Test Coverage
- [ ] Unit: Local import change detected
- [ ] Unit: MDX import change detected
- [ ] Unit: npm version change detected
- [ ] Integration: Full dependency chain invalidation
