# 030 - SSG App Router Support

## Priority: P2 - FEATURE GAP

## North Star
SSG build discovers and renders all App Router pages correctly.

## References
- Issues: [005.2-ssg-getallpages-missing-app-router.md](../005.2-ssg-getallpages-missing-app-router.md), [005.5-dynamic-route-handling-inconsistency.md](../005.5-dynamic-route-handling-inconsistency.md)
- RFC: [005.0-router-unification-rfc.md](../005.0-router-unification-rfc.md)

## Checklist
- [ ] Update `getAllPages()` to scan `app/` directory
- [ ] Handle `page.tsx` discovery (not just `pages/*.tsx`)
- [ ] Handle dynamic routes `[param]` in App Router
- [ ] Handle route groups `(group)` in App Router
- [ ] Handle parallel routes `@slot` in App Router
- [ ] Add `generateStaticParams` support for App Router

## Acceptance Criteria
- [ ] SSG build includes all App Router pages
- [ ] Dynamic routes expanded via generateStaticParams
- [ ] Route groups don't create URL segments
- [ ] Pages Router and App Router both work

## Quality Gates
- [ ] `getAllPages()` returns App Router pages
- [ ] SSG tests for App Router structure
- [ ] No silent skipping of pages

## Test Coverage
- [ ] Unit: Discover app/page.tsx
- [ ] Unit: Discover app/about/page.tsx
- [ ] Unit: Handle [param] routes
- [ ] Unit: Handle (group) routes
- [ ] Integration: SSG build with App Router project
