# Error Codes Refactoring Plan

Replace VF### numeric codes and schema enum with slug-based error identity, aligned with [RFC 9457](https://datatracker.ietf.org/doc/html/rfc9457).

---

## Target State

- `src/errors/error-codes.ts` — **deleted**
- `src/errors/schemas/error.schema.ts` error enum — **deleted**
- Zero VF### or schema enum references in codebase
- All HTTP responses use `application/problem+json` (RFC 9457)
- Single `src/errors/error-registry.ts` as the only source of error definitions

---

## Execution Plan

### Phase 1: Slug registry + RFC 9457 + tests

> 1.1–1.3 have no dependencies. Run as parallel subagents.

- [ ] **1.1** Create `src/errors/types.ts` — define `ErrorDefinition` type and `ErrorCategory` union (see [Categories](#error-categories))
- [ ] **1.2** Create `src/errors/error-registry.ts` — register all 69 errors (see [Error Registry](#error-registry))
- [ ] **1.3** Create `src/errors/error-registry.test.ts` — slug uniqueness + RFC 9457 shape tests

> 1.4 depends on 1.1–1.2.

- [ ] **1.4** Update `src/errors/veryfront-error.ts` — add `slug`, `category`, `cause`, `toRFC9457()` (see [Code Patterns](#code-patterns))
- [ ] **1.5** Update HTTP error response serialization to use `application/problem+json` (see [RFC 9457 Spec](#rfc-9457-response-spec))

### Phase 2: Migrate all references to slugs

> 2.1–2.5 are independent file migrations. Run as parallel subagents.

- [ ] **2.1** Migrate `src/errors/catalog/*.ts` to slug registry
- [ ] **2.2** Migrate `src/errors/agent-errors.ts` to slug registry
- [ ] **2.3** Migrate `src/errors/build-errors.ts` to slug registry
- [ ] **2.4** Migrate `src/errors/runtime-errors.ts` to slug registry
- [ ] **2.5** Migrate `src/errors/system-errors.ts` to slug registry

> 2.6–2.9 depend on 2.1–2.5.

- [ ] **2.6** Replace all `error.code === "VF###"` checks with `error.slug === "..."` across codebase
- [ ] **2.7** Replace all `error.code === "BUILD_ERROR"` (schema enum) checks with slug checks (see [Schema Overlap](#schema-overlap-resolution))
- [ ] **2.8** Update error constructors to require slug
- [ ] **2.9** Update all error tests to use slugs

### Phase 3: Delete legacy code

> 3.1–3.3 are independent. Run as parallel subagents.

- [ ] **3.1** Delete `src/errors/error-codes.ts`
- [ ] **3.2** Delete error code enum from `src/errors/schemas/error.schema.ts`
- [ ] **3.3** Update `src/errors/index.ts` — remove legacy exports, export registry only

> 3.4–3.5 verify the cleanup.

- [ ] **3.4** `grep -r "VF[0-9]" src/` returns zero matches
- [ ] **3.5** All tests pass

### Phase 4: Documentation

> 4.1–4.2 are independent. Run as parallel subagents.

- [ ] **4.1** Set up `https://veryfront.com/docs/errors/{slug}` pages (generated from registry)
- [ ] **4.2** Redirect old `/docs/errors/VF001` URLs → `/docs/errors/{slug}` for all 60 legacy codes
- [ ] **4.3** Add integration tests for documentation URLs

---

## Reference: Specifications

### Error Identity Model

Each error has two identifiers:

| Layer | Example | Purpose |
|-------|---------|---------|
| **Slug** (primary) | `config-not-found` | Stable unique ID, used in `type` URI, logs, docs |
| **Category** (grouping) | `CONFIG` | Domain-based filtering and error handling |

HTTP status is a per-error property, not encoded in the category.

### Error Categories

| Category   | Description                                       |
|------------|---------------------------------------------------|
| CONFIG     | Configuration & environment errors                |
| BUILD      | Build & compilation errors                        |
| RUNTIME    | Runtime execution & rendering errors              |
| ROUTE      | Route definition & resolution errors              |
| MODULE     | Module & import resolution errors                 |
| SERVER     | Server, infrastructure & network errors           |
| BOUNDARY   | RSC/client boundary violations                    |
| DEV        | Development-only tooling errors                   |
| DEPLOY     | Deployment & release errors                       |
| AGENT      | AI agent & orchestration errors                   |
| GENERAL    | Cross-cutting (permissions, timeouts, generic)    |

### Slug Naming Convention

1. `kebab-case`, lowercase, hyphens only
2. Pattern: `{domain}-{problem}` — e.g., `config-not-found`, `build-failed`
3. Be specific: `typescript-error` not `compile-error`
4. Avoid generic `-error` suffix when a better word exists: `build-failed` not `build-error`
5. Use `-not-found` for missing resources: `config-not-found`, `module-not-found`
6. Use `invalid-` prefix for validation: `invalid-import`, `invalid-route-file`
7. Max length: 40 characters

### RFC 9457 Response Spec

Applies to **HTTP-facing errors** only. CLI/build errors use slug + category + title + suggestion but omit `status` and `type`.

```
Content-Type: application/problem+json
```

```json
{
  "type": "https://veryfront.com/docs/errors/{slug}",
  "title": "Short summary, consistent across occurrences",
  "status": 404,
  "detail": "Explanation specific to this occurrence",
  "instance": "/api/projects/abc123/build",
  "category": "CONFIG",
  "suggestion": "Actionable fix for the developer",
  "cause": "slug-of-underlying-error"
}
```

| Field        | HTTP Errors | CLI/Build  | Description |
|--------------|-------------|------------|-------------|
| `type`       | Required    | Optional   | `https://veryfront.com/docs/errors/{slug}` |
| `title`      | Required    | Required   | Short summary |
| `status`     | Required    | Omitted    | HTTP status code |
| `detail`     | Recommended | Recommended| Occurrence-specific explanation |
| `instance`   | Optional    | Omitted    | URI for this specific occurrence |
| `category`   | Required    | Required   | Domain category |
| `suggestion` | Recommended | Recommended| Actionable fix (plain text, may include CLI commands) |
| `cause`      | Optional    | Optional   | Slug of underlying error (error chaining) |

---

## Reference: Code Patterns

### Error definition

```typescript
// src/errors/error-registry.ts
export const CONFIG_NOT_FOUND = defineError({
  slug: "config-not-found",
  category: "CONFIG",
  status: 404,
  title: "Configuration file not found",
  suggestion: "Run 'vf init' to create a configuration file",
});
```

### Throwing

```typescript
throw CONFIG_NOT_FOUND.create({
  detail: `Could not find veryfront.config.ts in ${projectDir}`,
});
```

### Error chaining

```typescript
try {
  await compileTypeScript(files);
} catch (err) {
  throw BUILD_FAILED.create({
    detail: "Build failed due to TypeScript compilation errors",
    cause: TYPESCRIPT_ERROR.slug,
  });
}
```

### Handling by category

```typescript
if (err instanceof VeryfrontError) {
  switch (err.category) {
    case "CONFIG":
      console.error(`Configuration issue: ${err.suggestion}`);
      break;
    case "BUILD":
      console.error(`Build failed: ${err.detail}`);
      break;
    default:
      console.error(`Error [${err.slug}]: ${err.title}`);
  }
}
```

### HTTP response serialization

```typescript
app.onError((err, c) => {
  if (err instanceof VeryfrontError) {
    return c.json(err.toRFC9457(), {
      status: err.status,
      headers: { "Content-Type": "application/problem+json" },
    });
  }
});
```

### Log format

```
[ERROR] config-not-found (CONFIG) — Configuration file not found
  Detail: Could not find veryfront.config.ts in /app/my-project
  Suggestion: Run 'vf init' to create a configuration file
  Docs: https://veryfront.com/docs/errors/config-not-found
```

---

## Reference: Error Registry

All 69 errors. The `Replaces` column shows the VF### code or schema name being removed.

### CONFIG

| Replaces | Slug                      | Title                                 | Status |
|----------|---------------------------|---------------------------------------|--------|
| VF001    | `config-not-found`        | Configuration file not found          | 404    |
| VF002    | `config-invalid`          | Invalid configuration format          | 400    |
| VF003    | `config-parse-error`      | Failed to parse configuration         | 400    |
| VF004    | `config-validation-error` | Configuration validation failed       | 422    |
| VF005    | `config-type-error`       | Configuration type mismatch           | 400    |
| VF006    | `import-map-invalid`      | Invalid import map configuration      | 400    |
| VF007    | `cors-config-invalid`     | Invalid CORS configuration            | 400    |

### BUILD

| Replaces | Slug                       | Title                                | Status |
|----------|----------------------------|--------------------------------------|--------|
| VF100    | `build-failed`             | Build process failed                 | 500    |
| VF101    | `bundle-error`             | Bundle generation failed             | 500    |
| VF102    | `typescript-error`         | TypeScript compilation error         | 500    |
| VF103    | `mdx-compile-error`        | MDX compilation failed               | 500    |
| VF104    | `asset-optimization-error` | Asset optimization failed            | 500    |
| VF105    | `ssg-generation-error`     | Static site generation failed        | 500    |
| VF106    | `sourcemap-error`          | Source map generation failed         | 500    |
| schema   | `compilation-error`        | Compilation failed                   | 500    |

### RUNTIME

| Replaces | Slug                 | Title                                | Status |
|----------|----------------------|--------------------------------------|--------|
| VF200    | `hydration-mismatch` | Client/server hydration mismatch     | 500    |
| VF201    | `render-error`       | Component render failed              | 500    |
| VF202    | `component-error`    | Component execution error            | 500    |
| VF203    | `layout-not-found`   | Layout component not found           | 404    |
| VF204    | `page-not-found`     | Page component not found             | 404    |
| VF205    | `api-error`          | API route handler error              | 500    |
| VF206    | `middleware-error`   | Middleware execution error           | 500    |

### ROUTE

| Replaces | Slug                    | Title                                | Status |
|----------|-------------------------|--------------------------------------|--------|
| VF300    | `route-conflict`        | Conflicting route definitions        | 409    |
| VF301    | `invalid-route-file`    | Invalid route file structure         | 400    |
| VF302    | `route-handler-invalid` | Invalid route handler export         | 400    |
| VF303    | `dynamic-route-error`   | Dynamic route parsing failed         | 500    |
| VF304    | `route-params-error`    | Route parameters invalid             | 400    |
| VF305    | `api-route-error`       | API route definition error           | 500    |

### MODULE

| Replaces | Slug                      | Title                                | Status |
|----------|---------------------------|--------------------------------------|--------|
| VF400    | `module-not-found`        | Module could not be resolved         | 404    |
| VF401    | `import-resolution-error` | Import path resolution failed        | 500    |
| VF402    | `circular-dependency`     | Circular dependency detected         | 500    |
| VF403    | `invalid-import`          | Invalid import statement             | 400    |
| VF404    | `dependency-missing`      | Required dependency not installed    | 404    |
| VF405    | `version-mismatch`        | Dependency version mismatch          | 409    |

### SERVER

| Replaces | Slug                  | Title                                | Status |
|----------|-----------------------|--------------------------------------|--------|
| VF500    | `port-in-use`         | Server port already in use           | 409    |
| VF501    | `server-start-error`  | Server failed to start               | 500    |
| VF503    | `cache-error`         | Cache operation failed               | 500    |
| VF504    | `file-watch-error`    | File watcher error                   | 500    |
| VF505    | `request-error`       | HTTP request handling error          | 500    |
| VF506    | `service-overloaded`  | Service overloaded                   | 503    |
| VF507    | `cache-path-mismatch` | Cache path mismatch                  | 500    |
| schema   | `network-error`       | Network operation failed             | 502    |

### BOUNDARY

| Replaces | Slug                        | Title                                | Status |
|----------|-----------------------------|--------------------------------------|--------|
| VF600    | `client-boundary-violation` | Client boundary rule violation       | 400    |
| VF601    | `server-only-in-client`     | Server-only code in client component | 400    |
| VF602    | `client-only-in-server`     | Client-only code in server component | 400    |
| VF603    | `invalid-use-client`        | Invalid 'use client' directive       | 400    |
| VF604    | `invalid-use-server`        | Invalid 'use server' directive       | 400    |
| VF605    | `rsc-payload-error`         | RSC payload serialization error      | 500    |

### DEV

| Replaces | Slug                  | Title                                | Status |
|----------|-----------------------|--------------------------------------|--------|
| VF502    | `hmr-error`           | Hot module replacement error         | 500    |
| VF700    | `dev-server-error`    | Development server error             | 500    |
| VF701    | `fast-refresh-error`  | Fast refresh failed                  | 500    |
| VF702    | `error-overlay-error` | Error overlay failed                 | 500    |
| VF703    | `source-map-error`    | Source map loading error             | 500    |

### DEPLOY

| Replaces | Slug                        | Title                                 | Status |
|----------|-----------------------------|---------------------------------------|--------|
| VF800    | `deployment-error`          | Deployment process failed             | 500    |
| VF801    | `platform-error`            | Platform-specific error               | 500    |
| VF802    | `env-var-missing`           | Required environment variable missing | 500    |
| VF803    | `production-build-required` | Production build required             | 400    |

### AGENT

| Replaces | Slug                  | Title                           | Status |
|----------|-----------------------|---------------------------------|--------|
| schema   | `agent-error`         | Agent operation error           | 500    |
| schema   | `agent-not-found`     | Agent not found                 | 404    |
| schema   | `agent-timeout`       | Agent operation timed out       | 408    |
| schema   | `agent-intent-error`  | Agent intent parsing error      | 400    |
| schema   | `orchestration-error` | Multi-agent orchestration error | 500    |

### GENERAL

| Replaces | Slug                    | Title                                 | Status |
|----------|-------------------------|---------------------------------------|--------|
| VF900    | `unknown-error`         | Unknown/unclassified error            | 500    |
| VF901    | `permission-denied`     | File/resource permission denied       | 403    |
| VF902    | `file-not-found`        | File not found                        | 404    |
| VF903    | `invalid-argument`      | Invalid function argument             | 400    |
| VF904    | `timeout-error`         | Operation timed out                   | 408    |
| schema   | `initialization-error`  | Initialization failed                 | 500    |
| schema   | `not-supported`         | Feature not supported                 | 501    |

### Schema Overlap Resolution

These 6 schema names overlap with VF### codes. Both are removed — the slug is the only identifier.

| Schema Name        | Canonical Slug      | Replaces VF Code |
|--------------------|---------------------|------------------|
| FILE_NOT_FOUND     | `file-not-found`    | VF902            |
| BUILD_ERROR        | `build-failed`      | VF100            |
| CONFIG_ERROR       | `config-invalid`    | VF002            |
| PERMISSION_ERROR   | `permission-denied` | VF901            |
| RENDER_ERROR       | `render-error`      | VF201            |
| SERVICE_OVERLOADED | `service-overloaded`| VF506            |

Migration: `if (error.code === "BUILD_ERROR")` → `if (error.slug === "build-failed")`. No aliases — all references updated in-place.

---

## Reference: File Changes

| File                                    | Phase | Change                                     |
|-----------------------------------------|-------|--------------------------------------------|
| `src/errors/types.ts`                   | 1     | Add `ErrorDefinition`, `ErrorCategory`     |
| `src/errors/error-registry.ts`          | 1     | **New:** 69 error definitions              |
| `src/errors/error-registry.test.ts`     | 1     | **New:** uniqueness + shape tests          |
| `src/errors/veryfront-error.ts`         | 1     | Add slug, category, cause, toRFC9457()     |
| `src/errors/catalog/*.ts`               | 2     | Migrate to slug registry                   |
| `src/errors/agent-errors.ts`            | 2     | Migrate to slug registry                   |
| `src/errors/build-errors.ts`            | 2     | Migrate to slug registry                   |
| `src/errors/runtime-errors.ts`          | 2     | Migrate to slug registry                   |
| `src/errors/system-errors.ts`           | 2     | Migrate to slug registry                   |
| `src/errors/error-codes.ts`             | 3     | **Delete**                                 |
| `src/errors/schemas/error.schema.ts`    | 3     | **Delete** error code enum                 |
| `src/errors/index.ts`                   | 3     | Remove legacy exports, export registry     |

---

## Reference: Error Lifecycle

When adding a new error after this migration:

1. Pick a slug (follow [naming convention](#slug-naming-convention))
2. Assign a category (from [category table](#error-categories))
3. Set HTTP status (omit for CLI-only errors)
4. Write title + suggestion
5. Add to `error-registry.ts`
