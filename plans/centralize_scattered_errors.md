# Centralize Scattered Error Classes

Migrate 7 error classes that extend plain `Error` into the centralized `VeryfrontError` + slug registry.

**Prerequisite:** Complete [error codes refactoring](./refactor_error_codes.md) (slug registry must exist).

---

## Target State

- 7 scattered error classes replaced with `VeryfrontError` + slug definitions in `error-registry.ts`
- `instanceof` checks migrated to `error.slug ===` checks
- 5 local control-flow errors documented as intentionally local

---

## New Slug Definitions

| Slug | Category | Status | Replaces | Location |
|------|----------|--------|----------|----------|
| `api-client-error` | SERVER | per-response | `VeryfrontAPIError` | `src/platform/adapters/veryfront-api-client/types.ts` |
| `config-validation-failed` | CONFIG | 400 | `ConfigValidationError` | `src/config/loader.ts` |
| `security-violation` | GENERAL | 403 | `SecurityError` | `src/security/secure-fs.ts` |
| `input-validation-failed` | GENERAL | 400 | `ValidationError` | `src/security/input-validation/errors.ts` |
| `token-storage-error` | SERVER | per-response | `TokenStorageError` | `src/platform/adapters/token/veryfront/types.ts` |
| `cache-invariant-violation` | SERVER | 500 | `CacheInvariantError` | `src/cache/paths.ts` + `src/transforms/esm/http-cache-invariants.ts` |
| `fallback-exhausted` | SERVER | 500 | `FallbackExecutionError` | `src/platform/adapters/fallback-wrapper.ts` |

---

## Intentionally Local (not centralizing)

These are internal control-flow errors — caught close to throw sites, never surface to users/logs.

| Class | Location | Reason |
|-------|----------|--------|
| `SemaphoreTimeoutError` | `src/utils/semaphore.ts` | Concurrency primitive, triggers retry |
| `TransformTreeTimeoutError` | `src/transforms/mdx/esm-module-loader/module-fetcher/index.ts` | Caught and converted at boundary |
| `NotSupportedError` | `src/platform/adapters/fs/wrapper.ts` | Adapter feature detection |
| `TimeoutError` | `src/rendering/utils/stream-utils.ts` | Generic primitive, wrapped before surfacing |
| `StreamTimeoutError` | `src/rendering/utils/stream-utils.ts` | Generic primitive, wrapped before surfacing |

---

## Execution Plan

### Phase 1: Add 7 slug definitions to registry

- [ ] **1.1** Add 7 new error definitions to `src/errors/error-registry.ts` (see table above)
- [ ] **1.2** Add tests for new slugs in `src/errors/error-registry.test.ts`

### Phase 2: Migrate each error class

> 2.1–2.7 are independent. Run as parallel subagents.

- [ ] **2.1** `VeryfrontAPIError` → `api-client-error` slug
  - File: `src/platform/adapters/veryfront-api-client/types.ts`
  - Used in: `client.ts`, `operations.ts`, `retry-handler.ts`, `index.ts`, `ssr.service.ts`, `snippet.handler.ts` (14 files total)
  - Preserve `status` and `details` as `VeryfrontError` fields
  - Re-export from `src/platform/adapters/index.ts`

- [ ] **2.2** `ConfigValidationError` → `config-validation-failed` slug
  - File: `src/config/loader.ts` (private class, 1 file only)
  - Replace with `throw CONFIG_VALIDATION_FAILED.create({ detail: message })`

- [ ] **2.3** `SecurityError` → `security-violation` slug
  - File: `src/security/secure-fs.ts`
  - Used in: `secure-fs.ts`, `index.ts` (2 files)
  - Preserve `code` and `path` fields via `detail` and error metadata

- [ ] **2.4** `ValidationError` → `input-validation-failed` slug
  - File: `src/security/input-validation/errors.ts`
  - Used in: 19 files across `src/security/input-validation/` and `src/security/path-validation/`
  - Preserve `details` field via `VeryfrontError.detail`

- [ ] **2.5** `TokenStorageError` → `token-storage-error` slug
  - File: `src/platform/adapters/token/veryfront/types.ts`
  - Used in: `api-client.ts`, `index.ts`, `adapters/index.ts` (7 files)
  - Preserve `statusCode` and `details` fields

- [ ] **2.6** `CacheInvariantError` → `cache-invariant-violation` slug
  - Files: `src/cache/paths.ts` + `src/transforms/esm/http-cache-invariants.ts`
  - Used in: `tokenizing-gateway.ts`, `http-cache.ts`, `http-cache-wrapper.ts`, `cache/index.ts` (6 files)
  - Two classes (base + subclass) — consolidate into single slug

- [ ] **2.7** `FallbackExecutionError` → `fallback-exhausted` slug
  - File: `src/platform/adapters/fallback-wrapper.ts`
  - Used in: `adapters/index.ts` (4 files)
  - Preserve `primaryError` and `fallbackError` via error chaining (`cause`)

### Phase 3: Delete old error classes

> 3.1–3.7 are independent. Run as parallel subagents.

- [ ] **3.1** Delete `VeryfrontAPIError` class from `types.ts`
- [ ] **3.2** Delete `ConfigValidationError` class from `loader.ts`
- [ ] **3.3** Delete `SecurityError` class from `secure-fs.ts`
- [ ] **3.4** Delete `ValidationError` class from `errors.ts`
- [ ] **3.5** Delete `TokenStorageError` class from `types.ts`
- [ ] **3.6** Delete both `CacheInvariantError` classes
- [ ] **3.7** Delete `FallbackExecutionError` class from `fallback-wrapper.ts`

### Phase 4: Verify

- [ ] **4.1** `grep -r "extends Error" src/ --include="*.ts"` — only intentionally local errors remain (5 listed above)
- [ ] **4.2** All tests pass

---

## File Changes

| File | Phase | Change |
|------|-------|--------|
| `src/errors/error-registry.ts` | 1 | Add 7 definitions |
| `src/errors/error-registry.test.ts` | 1 | Add 7 slug tests |
| `src/platform/adapters/veryfront-api-client/types.ts` | 2–3 | Replace class → import slug |
| `src/platform/adapters/veryfront-api-client/client.ts` | 2 | Update throws |
| `src/platform/adapters/veryfront-api-client/operations.ts` | 2 | Update throws |
| `src/platform/adapters/veryfront-api-client/retry-handler.ts` | 2 | Update instanceof → slug check |
| `src/config/loader.ts` | 2–3 | Replace class → import slug |
| `src/security/secure-fs.ts` | 2–3 | Replace class → import slug |
| `src/security/input-validation/errors.ts` | 2–3 | Replace class → import slug |
| `src/security/input-validation/*.ts` (18 files) | 2 | Update instanceof → slug check |
| `src/platform/adapters/token/veryfront/types.ts` | 2–3 | Replace class → import slug |
| `src/platform/adapters/token/veryfront/api-client.ts` | 2 | Update throws |
| `src/cache/paths.ts` | 2–3 | Replace class → import slug |
| `src/transforms/esm/http-cache-invariants.ts` | 2–3 | Replace class → import slug |
| `src/platform/adapters/fallback-wrapper.ts` | 2–3 | Replace class → import slug |

---

## Migration Pattern

Before:
```typescript
import { VeryfrontAPIError } from "./types.ts";
throw new VeryfrontAPIError("Not found", 404, { id: "abc" });
```

After:
```typescript
import { API_CLIENT_ERROR } from "#veryfront/errors/error-registry.ts";
throw API_CLIENT_ERROR.create({
  detail: "Not found",
  status: 404,
});
```

Before (instanceof check):
```typescript
if (error instanceof VeryfrontAPIError) {
  console.error(`API error: ${error.status}`);
}
```

After:
```typescript
if (error instanceof VeryfrontError && error.slug === "api-client-error") {
  console.error(`API error: ${error.status}`);
}
```
