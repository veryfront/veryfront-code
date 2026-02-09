# Error Handling Middleware

Unified error catch → serialize → respond pipeline at all system boundaries (HTTP, CLI, WebSocket).

**Prerequisite:** [Error codes refactoring](./refactor_error_codes.md) (slug registry + `toRFC9457()` must exist).

---

## Problem

Error handling is ad-hoc across boundaries:

- `src/server/universal-handler/index.ts` catches timeouts and returns `JSON.stringify({ error: "Request timeout" })` — no RFC 9457, no slug
- `src/routing/api/error-handler.ts` (`handleAPIError`) returns different shapes in dev vs production
- `src/errors/error-handlers.ts` provides `handleError()`, `wrapError()`, `logAndThrow()` — all log differently, none serialize to RFC 9457
- `src/errors/user-friendly/error-wrapper.ts` wraps errors for dev overlay — separate from HTTP serialization
- CLI commands catch errors independently with inconsistent formatting
- Plain `Error` throws (289 files) bypass structured handling entirely

---

## Target State

- Single `errorBoundary()` middleware at each system boundary
- All HTTP responses for errors use `application/problem+json`
- All CLI error output uses structured format: `[slug] title\n  detail\n  suggestion`
- Plain `Error` throws get auto-wrapped to `unknown-error` slug at boundary
- Dev mode adds stack traces; production omits them
- Existing `handleError()`, `wrapError()`, `logAndThrow()` deprecated, then deleted

---

## Execution Plan

### Phase 1: HTTP error boundary middleware

- [ ] **1.1** Create `src/errors/middleware/http-error-boundary.ts`
  - Catch all errors from request handlers
  - `VeryfrontError` → `toRFC9457()` with `application/problem+json`
  - Plain `Error` → wrap as `unknown-error` slug, then serialize
  - Dev mode: include `stack` field in response
  - Production: omit `stack`, omit `detail` for 5xx errors

- [ ] **1.2** Create `src/errors/middleware/http-error-boundary.test.ts`
  - VeryfrontError → correct RFC 9457 shape
  - Plain Error → wrapped as unknown-error
  - Dev vs production output differences
  - Content-Type header is `application/problem+json`

> 1.3–1.4 depend on 1.1

- [ ] **1.3** Wire into `src/server/universal-handler/index.ts`
  - Replace inline catch blocks with `httpErrorBoundary()`
  - Replace timeout `JSON.stringify({ error: ... })` with RFC 9457 `timeout-error` slug

- [ ] **1.4** Wire into `src/routing/api/route-executor.ts` and `error-handler.ts`
  - Replace `handleAPIError()` with `httpErrorBoundary()`
  - Delete `src/routing/api/error-handler.ts` after migration

### Phase 2: CLI error boundary

- [ ] **2.1** Create `src/errors/middleware/cli-error-boundary.ts`
  - Format: `[slug] title\n  detail\n  suggestion`
  - Dev mode: include stack trace
  - Exit code: 1 for all errors
  - Color output when TTY

- [ ] **2.2** Create `src/errors/middleware/cli-error-boundary.test.ts`

> 2.3 depends on 2.1

- [ ] **2.3** Wire into CLI command handlers
  - Replace per-command try/catch with `cliErrorBoundary(handler)`
  - Affected: `src/cli/commands/*/command.ts`

### Phase 3: Error wrapping at boundaries

- [ ] **3.1** Create `src/errors/middleware/wrap-unknown.ts`
  - `wrapUnknownError(error: unknown): VeryfrontError` — wraps any non-VeryfrontError as `unknown-error` slug
  - Preserves original error as `cause`
  - Extracts message, stack from original

- [ ] **3.2** Update `src/errors/error-handlers.ts`
  - `wrapError()` → use `wrapUnknownError()` internally
  - `handleError()` → use structured log format from observability plan
  - `logAndThrow()` → deprecate (boundary middleware handles this)

### Phase 4: Delete legacy error handling

> 4.1–4.3 are independent. Run as parallel subagents.

- [ ] **4.1** Delete `src/routing/api/error-handler.ts` (replaced by http-error-boundary)
- [ ] **4.2** Delete `handleError()`, `logAndThrow()` from `src/errors/error-handlers.ts` (replaced by boundary middleware)
- [ ] **4.3** Update `src/errors/index.ts` — remove deleted exports

### Phase 5: Verify

- [ ] **5.1** No HTTP responses return `{ error: "..." }` — all use RFC 9457
- [ ] **5.2** All CLI errors show slug + suggestion
- [ ] **5.3** All tests pass

---

## Code Patterns

### HTTP error boundary

```typescript
// src/errors/middleware/http-error-boundary.ts
export function httpErrorBoundary(handler: RequestHandler): RequestHandler {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (error) {
      const vfError = error instanceof VeryfrontError
        ? error
        : wrapUnknownError(error);

      const body = vfError.toRFC9457();
      if (!ctx.isDev) {
        delete body.stack;
        if (vfError.status >= 500) delete body.detail;
      }

      return new Response(JSON.stringify(body), {
        status: vfError.status,
        headers: { "Content-Type": "application/problem+json" },
      });
    }
  };
}
```

### CLI error boundary

```typescript
// src/errors/middleware/cli-error-boundary.ts
export function cliErrorBoundary(handler: () => Promise<void>): () => Promise<void> {
  return async () => {
    try {
      await handler();
    } catch (error) {
      const vfError = error instanceof VeryfrontError
        ? error
        : wrapUnknownError(error);

      console.error(`[${vfError.slug}] ${vfError.title}`);
      if (vfError.detail) console.error(`  ${vfError.detail}`);
      if (vfError.suggestion) console.error(`  ${vfError.suggestion}`);
      Deno.exit(1);
    }
  };
}
```

---

## File Changes

| File | Phase | Change |
|------|-------|--------|
| `src/errors/middleware/http-error-boundary.ts` | 1 | **New** |
| `src/errors/middleware/http-error-boundary.test.ts` | 1 | **New** |
| `src/errors/middleware/cli-error-boundary.ts` | 2 | **New** |
| `src/errors/middleware/cli-error-boundary.test.ts` | 2 | **New** |
| `src/errors/middleware/wrap-unknown.ts` | 3 | **New** |
| `src/server/universal-handler/index.ts` | 1 | Replace inline catches |
| `src/routing/api/route-executor.ts` | 1 | Use http-error-boundary |
| `src/routing/api/error-handler.ts` | 4 | **Delete** |
| `src/errors/error-handlers.ts` | 3–4 | Deprecate → delete legacy fns |
| `src/cli/commands/*/command.ts` | 2 | Wrap with cliErrorBoundary |
