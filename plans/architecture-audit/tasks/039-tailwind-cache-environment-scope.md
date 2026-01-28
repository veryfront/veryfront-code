# 039 - Tailwind Cache Environment Scope

## Priority: P1 - SECURITY

## North Star
Tailwind CSS cache isolated by environment. Preview changes never leak to production.

## References
- Issue: [002.9-tailwind-cache-environment-scope.md](../002.9-tailwind-cache-environment-scope.md)
- Related: [002.8-tailwind-compiler-state.md](../002.8-tailwind-compiler-state.md)

## The Problem

Current cache key: `${projectSlug}:${stylesheetHash}`
Missing: **environment** (preview vs production)

This allows:
- Preview CSS changes to leak to production users
- Production rollbacks serving stale preview CSS
- Branch A CSS polluting Branch B

## Checklist
- [ ] Add environment parameter to `getProjectCSS()`
- [ ] Update cache key: `${projectSlug}:${environment}:${stylesheetHash}`
- [ ] Pass environment from request context (x-environment header)
- [ ] Update all callers of `getProjectCSS()`
- [ ] Invalidate existing cache (one-time deploy step)
- [ ] Add environment isolation test

## Acceptance Criteria
- [ ] Preview CSS changes don't affect production
- [ ] Production rollback serves correct CSS version
- [ ] Cache key includes environment
- [ ] Same project, different environments = separate cache

## Quality Gates
- [ ] Cache key format: `projectSlug:environment:stylesheetHash`
- [ ] Test: preview/production isolation
- [ ] No cross-environment cache hits

## Test Coverage
- [ ] Unit: Same stylesheet, different environments → different keys
- [ ] Unit: Preview change doesn't affect production cache
- [ ] Integration: Deploy preview, verify production unchanged
