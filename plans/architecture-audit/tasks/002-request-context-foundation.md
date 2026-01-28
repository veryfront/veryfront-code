# 002 - Request Context Foundation (AsyncLocalStorage)

## Priority: P0 - FOUNDATION

## North Star
Every request runs in isolated AsyncLocalStorage context. All request-scoped state accessed via `getRequestContext()`.

## References
- RFC: [002.0-request-scoped-state-rfc.md](../002.0-request-scoped-state-rfc.md)
- Issues: [002.1](../002.1-head-collector-leakage.md), [002.2](../002.2-ssr-globals-context-leakage.md), [007.7](../007.7-runtime-config-global-singleton.md)

## Checklist
- [ ] Create `src/core/request-context.ts` with AsyncLocalStorage
- [ ] Define `RequestContext` interface (projectId, slug, env, requestId)
- [ ] Implement `runWithRequestContext<T>(ctx, fn)` wrapper
- [ ] Implement `getRequestContext()` accessor
- [ ] Implement `requireRequestContext()` with clear error
- [ ] Wrap request handler entry points with context

## Acceptance Criteria
- [ ] `getRequestContext()` returns correct project in nested async calls
- [ ] Concurrent requests have isolated contexts
- [ ] Context available in all SSR code paths
- [ ] Clear error when called outside request context

## Quality Gates
- [ ] No `let` module-level variables for request state after migration
- [ ] All request handlers wrapped with `runWithRequestContext`
- [ ] TypeScript enforces context access patterns

## Test Coverage
- [ ] Unit: Context isolation between concurrent calls
- [ ] Unit: Context propagates through async/await
- [ ] Unit: Context propagates through Promise.all
- [ ] Integration: Two projects render concurrently with correct context
- [ ] Stress: 100 concurrent requests maintain isolation
