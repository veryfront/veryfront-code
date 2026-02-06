# Error Codes Refactoring Plan

## Overview

This plan documents all existing error codes in the Veryfront codebase and proposes a slug-based error identity system aligned with [RFC 9457](https://datatracker.ietf.org/doc/html/rfc9457) (Problem Details for HTTP APIs) to improve error handling consistency, developer experience, and standards compliance.

---

## Current State Analysis

### Error Code Systems

The codebase currently uses **two parallel error code systems**:

#### 1. VF### Code System (Primary)
- **Location:** `src/errors/error-codes.ts`
- **Format:** `VF###` (e.g., VF001, VF200)
- **Count:** 60 error codes across 10 numeric ranges
- **Auto-generated docs URL:** `https://veryfront.com/docs/errors/{code}`

#### 2. Schema-Based Error Codes
- **Location:** `src/errors/schemas/error.schema.ts`
- **Format:** `UPPER_SNAKE_CASE` (e.g., FILE_NOT_FOUND)
- **Count:** 15 error codes (6 overlap with VF### system)
- **Validated via Zod schema**

### Problems with the Current System

1. **Numeric codes don't scale** — Pre-allocated ranges (VF001-VF099) create artificial limits and empty gaps
2. **Numbers carry no meaning** — `VF507` requires a lookup table; nobody memorizes 60+ codes
3. **Two parallel systems** — VF### and schema-based codes overlap (e.g., both have FILE_NOT_FOUND, RENDER_ERROR) with no defined consolidation strategy
4. **No standard response shape** — Error responses don't follow an established standard
5. **Renumbering is painful** — Any restructuring is a breaking change for log alerts, error handlers, and docs URLs

---

## Proposed System: Slug-Based Error Identity

### Error Identity Model

Each error has two identifiers:

| Layer | Example | Purpose |
|-------|---------|---------|
| **Slug** (primary) | `config-not-found` | Stable unique identifier, used in `type` URI, logs, docs |
| **Category** (grouping) | `CONFIG` | Domain-based filtering and error handling logic |

The HTTP status code is a per-error property, not encoded in the category.

### Why Slugs Instead of Numeric Codes

Numeric codes (VF001, VFN001) don't scale:

- **Range exhaustion** — Pre-allocated ranges fill up or leave gaps
- **False ordering** — VF001 looks more important than VF904; it isn't
- **Renumbering treadmill** — Restructuring numbers is always a breaking change
- **Nobody memorizes them** — With 60+ errors, you always have to look them up

Slugs solve all of these:

- **Self-documenting** — `config-not-found` tells you everything at a glance
- **Infinite scaling** — No ranges to exhaust; just pick a descriptive slug
- **Stable** — Slugs never need renumbering; categories can change without breaking consumers
- **Greppable** — `grep "config-not-found"` works just as well as `grep "VF001"`

### Error Categories

Categories are **domain-based** — they group errors by the subsystem that produces them, not by HTTP status code. HTTP status is a per-error property (see the registry below).

| Category   | Description                          |
|------------|--------------------------------------|
| CONFIG     | Configuration & environment errors   |
| BUILD      | Build & compilation errors           |
| RUNTIME    | Runtime execution & rendering errors |
| ROUTE      | Route definition & resolution errors |
| MODULE     | Module & import resolution errors    |
| SERVER     | Server, infrastructure & network errors |
| BOUNDARY   | RSC/client boundary violations       |
| DEV        | Development-only tooling errors      |
| DEPLOY     | Deployment & release errors          |
| AGENT      | AI agent & orchestration errors      |
| GENERAL    | Cross-cutting errors (permissions, timeouts, generic failures) |

### Slug Naming Convention

Slugs must follow these rules:

1. **Format:** `kebab-case`, lowercase, hyphens only
2. **Pattern:** `{domain}-{problem}` preferred — e.g., `config-not-found`, `build-failed`
3. **Be specific:** prefer `typescript-error` over `compile-error`, prefer `build-failed` over `build-error`
4. **Avoid generic `-error` suffix** when a more specific problem word exists: `build-failed` not `build-error`, `service-overloaded` not `service-error`
5. **Use `-not-found` for missing resources:** `config-not-found`, `module-not-found`, `page-not-found`
6. **Use `invalid-` prefix for validation:** `invalid-import`, `invalid-route-file`
7. **Max length:** 40 characters

### Error Definition

```typescript
defineError({
  slug: "config-not-found",
  category: "CONFIG",
  status: 404,
  title: "Configuration file not found",
  suggestion: "Run 'vf init' to create a configuration file",
});
```

Adding a new error = pick a slug + assign a category. No ranges to manage.

---

## RFC 9457 Error Response Standard

Error responses returned over HTTP should conform to [RFC 9457](https://datatracker.ietf.org/doc/html/rfc9457) (Problem Details for HTTP APIs).

**Important:** RFC 9457 applies to **HTTP-facing errors** (API responses, server errors returned to clients). For CLI and build errors that never travel over HTTP, the slug + category + title + suggestion fields are still used, but HTTP status and the `type` URI are informational rather than required.

### Response Shape

```json
HTTP/1.1 404 Not Found
Content-Type: application/problem+json

{
  "type": "https://veryfront.com/docs/errors/config-not-found",
  "title": "Configuration file not found",
  "status": 404,
  "detail": "Could not find veryfront.config.ts in /app/my-project",
  "instance": "/api/projects/abc123/build",
  "category": "CONFIG",
  "suggestion": "Run 'vf init' to create a configuration file"
}
```

#### Standard Fields (RFC 9457)

| Field      | HTTP Errors | CLI/Build Errors | Description |
|------------|-------------|------------------|-------------|
| `type`     | Required    | Optional         | `https://veryfront.com/docs/errors/{slug}` |
| `title`    | Required    | Required         | Short summary, consistent across occurrences |
| `status`   | Required    | Omitted          | HTTP status code (only meaningful for HTTP responses) |
| `detail`   | Recommended | Recommended      | Explanation specific to this occurrence |
| `instance` | Optional    | Omitted          | URI identifying this specific occurrence |

#### Veryfront Extension Fields

| Field        | Required    | Description |
|--------------|-------------|-------------|
| `category`   | Yes         | Domain category for filtering |
| `suggestion` | Recommended | Plain text, actionable fix for the developer. May include CLI commands. |
| `cause`      | Optional    | Slug of the underlying error when errors are chained (e.g., `build-failed` caused by `typescript-error`) |

**Content-Type:** HTTP responses containing problem details MUST use `Content-Type: application/problem+json`.

---

## Complete Error Registry

This is the single source of truth for all errors. The `Replaces` column shows the VF### code or schema name being removed.

### CONFIG — Configuration & environment errors

| Replaces | Slug                      | Title                                 | Status |
|--------|---------------------------|---------------------------------------|--------|
| VF001  | `config-not-found`        | Configuration file not found          | 404    |
| VF002  | `config-invalid`          | Invalid configuration format          | 400    |
| VF003  | `config-parse-error`      | Failed to parse configuration         | 400    |
| VF004  | `config-validation-error` | Configuration validation failed       | 422    |
| VF005  | `config-type-error`       | Configuration type mismatch           | 400    |
| VF006  | `import-map-invalid`      | Invalid import map configuration      | 400    |
| VF007  | `cors-config-invalid`     | Invalid CORS configuration            | 400    |

### BUILD — Build & compilation errors

| Replaces | Slug                       | Title                                | Status |
|--------|----------------------------|--------------------------------------|--------|
| VF100  | `build-failed`             | Build process failed                 | 500    |
| VF101  | `bundle-error`             | Bundle generation failed             | 500    |
| VF102  | `typescript-error`         | TypeScript compilation error         | 500    |
| VF103  | `mdx-compile-error`        | MDX compilation failed               | 500    |
| VF104  | `asset-optimization-error` | Asset optimization failed            | 500    |
| VF105  | `ssg-generation-error`     | Static site generation failed        | 500    |
| VF106  | `sourcemap-error`          | Source map generation failed         | 500    |
| schema | `compilation-error`        | Compilation failed                   | 500    |

### RUNTIME — Runtime execution & rendering errors

| Replaces | Slug                 | Title                                | Status |
|--------|----------------------|--------------------------------------|--------|
| VF200  | `hydration-mismatch` | Client/server hydration mismatch     | 500    |
| VF201  | `render-error`       | Component render failed              | 500    |
| VF202  | `component-error`    | Component execution error            | 500    |
| VF203  | `layout-not-found`   | Layout component not found           | 404    |
| VF204  | `page-not-found`     | Page component not found             | 404    |
| VF205  | `api-error`          | API route handler error              | 500    |
| VF206  | `middleware-error`   | Middleware execution error           | 500    |

### ROUTE — Route definition & resolution errors

| Replaces | Slug                    | Title                                | Status |
|--------|-------------------------|--------------------------------------|--------|
| VF300  | `route-conflict`        | Conflicting route definitions        | 409    |
| VF301  | `invalid-route-file`    | Invalid route file structure         | 400    |
| VF302  | `route-handler-invalid` | Invalid route handler export         | 400    |
| VF303  | `dynamic-route-error`   | Dynamic route parsing failed         | 500    |
| VF304  | `route-params-error`    | Route parameters invalid             | 400    |
| VF305  | `api-route-error`       | API route definition error           | 500    |

### MODULE — Module & import resolution errors

| Replaces | Slug                      | Title                                | Status |
|--------|---------------------------|--------------------------------------|--------|
| VF400  | `module-not-found`        | Module could not be resolved         | 404    |
| VF401  | `import-resolution-error` | Import path resolution failed        | 500    |
| VF402  | `circular-dependency`     | Circular dependency detected         | 500    |
| VF403  | `invalid-import`          | Invalid import statement             | 400    |
| VF404  | `dependency-missing`      | Required dependency not installed    | 404    |
| VF405  | `version-mismatch`        | Dependency version mismatch          | 409    |

### SERVER — Server, infrastructure & network errors

| Replaces | Slug                  | Title                                | Status |
|--------|-----------------------|--------------------------------------|--------|
| VF500  | `port-in-use`         | Server port already in use           | 409    |
| VF501  | `server-start-error`  | Server failed to start               | 500    |
| VF503  | `cache-error`         | Cache operation failed               | 500    |
| VF504  | `file-watch-error`    | File watcher error                   | 500    |
| VF505  | `request-error`       | HTTP request handling error          | 500    |
| VF506  | `service-overloaded`  | Service overloaded                   | 503    |
| VF507  | `cache-path-mismatch` | Cache path mismatch                  | 500    |
| schema | `network-error`       | Network operation failed             | 502    |

### BOUNDARY — RSC/client boundary violations

| Replaces | Slug                        | Title                                | Status |
|--------|-----------------------------|--------------------------------------|--------|
| VF600  | `client-boundary-violation` | Client boundary rule violation       | 400    |
| VF601  | `server-only-in-client`     | Server-only code in client component | 400    |
| VF602  | `client-only-in-server`     | Client-only code in server component | 400    |
| VF603  | `invalid-use-client`        | Invalid 'use client' directive       | 400    |
| VF604  | `invalid-use-server`        | Invalid 'use server' directive       | 400    |
| VF605  | `rsc-payload-error`         | RSC payload serialization error      | 500    |

### DEV — Development-only tooling errors

| Replaces | Slug                  | Title                                | Status |
|--------|-----------------------|--------------------------------------|--------|
| VF502  | `hmr-error`           | Hot module replacement error         | 500    |
| VF700  | `dev-server-error`    | Development server error             | 500    |
| VF701  | `fast-refresh-error`  | Fast refresh failed                  | 500    |
| VF702  | `error-overlay-error` | Error overlay failed                 | 500    |
| VF703  | `source-map-error`    | Source map loading error             | 500    |

### DEPLOY — Deployment & release errors

| Replaces | Slug                        | Title                                 | Status |
|--------|-----------------------------|---------------------------------------|--------|
| VF800  | `deployment-error`          | Deployment process failed             | 500    |
| VF801  | `platform-error`            | Platform-specific error               | 500    |
| VF802  | `env-var-missing`           | Required environment variable missing | 500    |
| VF803  | `production-build-required` | Production build required             | 400    |

### AGENT — AI agent & orchestration errors

| Replaces | Slug                  | Title                          | Status |
|--------|-----------------------|--------------------------------|--------|
| schema | `agent-error`         | Agent operation error          | 500    |
| schema | `agent-not-found`     | Agent not found                | 404    |
| schema | `agent-timeout`       | Agent operation timed out      | 408    |
| schema | `agent-intent-error`  | Agent intent parsing error     | 400    |
| schema | `orchestration-error` | Multi-agent orchestration error| 500    |

### GENERAL — Cross-cutting errors

Errors that aren't specific to a single domain. Consumers should rely on HTTP status codes for handling logic (e.g., 403 → show permission error, 408 → retry).

| Replaces | Slug                    | Title                                 | Status |
|--------|-------------------------|---------------------------------------|--------|
| VF900  | `unknown-error`         | Unknown/unclassified error            | 500    |
| VF901  | `permission-denied`     | File/resource permission denied       | 403    |
| VF902  | `file-not-found`        | File not found                        | 404    |
| VF903  | `invalid-argument`      | Invalid function argument             | 400    |
| VF904  | `timeout-error`         | Operation timed out                   | 408    |
| schema | `initialization-error`  | Initialization failed                 | 500    |
| schema | `not-supported`         | Feature not supported                 | 501    |

### Schema Overlap Resolution

These schema-based error codes overlap with VF### codes and will be **merged** into the slug registry. Both the schema name and VF### code will be removed — the slug is the only identifier.

| Schema Name        | Canonical Slug     | Replaces VF Code |
|--------------------|--------------------|------------------|
| FILE_NOT_FOUND     | `file-not-found`   | VF902            |
| BUILD_ERROR        | `build-failed`     | VF100            |
| CONFIG_ERROR       | `config-invalid`   | VF002            |
| PERMISSION_ERROR   | `permission-denied`| VF901            |
| RENDER_ERROR       | `render-error`     | VF201            |
| SERVICE_OVERLOADED | `service-overloaded`| VF506           |

**Migration:** `if (error.code === "BUILD_ERROR")` → `if (error.slug === "build-failed")`. No aliases, no compatibility layer — all references are updated in-place.

---

## Programmatic Usage

### Defining an error

```typescript
// src/errors/error-registry.ts
import { defineError } from "./define-error.ts";

export const CONFIG_NOT_FOUND = defineError({
  slug: "config-not-found",
  category: "CONFIG",
  status: 404,
  title: "Configuration file not found",
  suggestion: "Run 'vf init' to create a configuration file",
});
```

### Throwing an error

```typescript
import { CONFIG_NOT_FOUND } from "../errors/error-registry.ts";

throw CONFIG_NOT_FOUND.create({
  detail: `Could not find veryfront.config.ts in ${projectDir}`,
});
```

### Throwing with a cause (error chaining)

```typescript
import { BUILD_FAILED, TYPESCRIPT_ERROR } from "../errors/error-registry.ts";

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
import { VeryfrontError } from "../errors/veryfront-error.ts";

try {
  await buildProject();
} catch (err) {
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
}
```

### Serializing to HTTP response (RFC 9457)

```typescript
import { VeryfrontError } from "../errors/veryfront-error.ts";

app.onError((err, c) => {
  if (err instanceof VeryfrontError) {
    return c.json(err.toRFC9457(), {
      status: err.status,
      headers: { "Content-Type": "application/problem+json" },
    });
  }
});
```

`toRFC9457()` returns:

```json
{
  "type": "https://veryfront.com/docs/errors/config-not-found",
  "title": "Configuration file not found",
  "status": 404,
  "detail": "Could not find veryfront.config.ts in /app/my-project",
  "category": "CONFIG",
  "suggestion": "Run 'vf init' to create a configuration file"
}
```

### Log output

```
[ERROR] config-not-found (CONFIG) — Configuration file not found
  Detail: Could not find veryfront.config.ts in /app/my-project
  Suggestion: Run 'vf init' to create a configuration file
  Docs: https://veryfront.com/docs/errors/config-not-found
```

---

## Implementation Plan

### Target State

After all phases are complete:

- `error-codes.ts` (VF### constants) — **deleted**
- `error.schema.ts` enum — **deleted**
- All error references use slugs — no numeric codes anywhere in the codebase
- All HTTP error responses use `application/problem+json` with RFC 9457 shape
- All error docs live at `https://veryfront.com/docs/errors/{slug}`
- Single `error-registry.ts` is the only source of error definitions

### Phase 1: Slug registry + RFC 9457 response shape + tests

- [ ] Define `ErrorDefinition` type with slug, category, status, title, suggestion
- [ ] Define `ErrorCategory` union type from the category table
- [ ] Create slug registry (`error-registry.ts`) with all 69 error definitions
- [ ] Add `slug`, `category`, `cause`, and `toRFC9457()` to `VeryfrontError` class
- [ ] Update HTTP error response serialization to use `application/problem+json`
- [ ] Add unit tests for slug uniqueness (no duplicate slugs)
- [ ] Add unit tests for RFC 9457 response shape

### Phase 2: Migrate all error references to slugs

Replace every VF### code and schema enum reference in the codebase with slug lookups.

- [ ] Update all `error.code === "VF###"` checks to use `error.slug === "..."`
- [ ] Update all `error.code === "BUILD_ERROR"` (schema) checks to use slugs
- [ ] Migrate `src/errors/catalog/*.ts` to use slug registry
- [ ] Migrate `src/errors/agent-errors.ts` to use slug registry
- [ ] Migrate `src/errors/build-errors.ts` to use slug registry
- [ ] Migrate `src/errors/runtime-errors.ts` to use slug registry
- [ ] Migrate `src/errors/system-errors.ts` to use slug registry
- [ ] Update error constructors to require slug
- [ ] Update all error tests to use slugs

### Phase 3: Delete legacy code

- [ ] Delete `src/errors/error-codes.ts` (VF### constants)
- [ ] Delete error code enum from `src/errors/schemas/error.schema.ts`
- [ ] Remove all VF### references from codebase (grep to verify zero matches)
- [ ] Remove all schema enum references from codebase (grep to verify zero matches)
- [ ] Update `src/errors/index.ts` exports (remove legacy, export registry only)

### Phase 4: Documentation

- [ ] Set up `https://veryfront.com/docs/errors/{slug}` pages
- [ ] Each page: title, description, category, suggestion, related errors
- [ ] Redirect old `/docs/errors/VF001` URLs to `/docs/errors/config-not-found`
- [ ] Generate error docs from the slug registry (single source of truth)
- [ ] Add integration tests for error documentation URLs

---

## Error Lifecycle

When adding a new error:

1. **Pick a slug** — follow the [naming convention](#slug-naming-convention)
2. **Assign a category** — from the [category table](#error-categories)
3. **Set HTTP status** — what status code should the API return? (omit for CLI-only errors)
4. **Write title + suggestion** — what went wrong and how to fix it
5. **Register it** — add to `error-registry.ts`
6. **Docs auto-generated** — the `/docs/errors/{slug}` page is created from the registry

No ranges to check, no numbers to allocate, no gaps to worry about.

---

## File Changes Required

| File                                    | Phase | Changes                                    |
|-----------------------------------------|-------|--------------------------------------------|
| `src/errors/error-registry.ts`          | 1     | **New:** slug registry with all error definitions |
| `src/errors/types.ts`                   | 1     | Add ErrorDefinition, ErrorCategory types   |
| `src/errors/veryfront-error.ts`         | 1     | Add slug, category, toRFC9457(), cause     |
| `src/errors/error-registry.test.ts`     | 1     | **New:** slug uniqueness + RFC 9457 shape tests |
| `src/errors/catalog/*.ts`               | 2     | Migrate to slug registry                   |
| `src/errors/agent-errors.ts`            | 2     | Migrate to slug registry                   |
| `src/errors/build-errors.ts`            | 2     | Migrate to slug registry                   |
| `src/errors/runtime-errors.ts`          | 2     | Migrate to slug registry                   |
| `src/errors/system-errors.ts`           | 2     | Migrate to slug registry                   |
| `src/errors/error-codes.ts`             | 3     | **Delete** (VF### constants removed)       |
| `src/errors/schemas/error.schema.ts`    | 3     | **Delete** error code enum                 |
| `src/errors/index.ts`                   | 3     | Remove legacy exports, export registry only |

---

## Design Principles

1. **Fail Fast**: Error early at the point of failure, don't let invalid state propagate
2. **No Unnecessary Fallbacks**: Avoid silent fallbacks that mask real issues — if something fails, surface it immediately
3. **Explicit Over Implicit**: Throw explicit errors rather than returning default values or empty states
4. **Clear Root Cause**: Error messages should identify the exact cause, not symptoms
5. **Actionable Errors**: Every error should tell the developer what went wrong and how to fix it
6. **Standards-First**: Follow RFC 9457 for HTTP error responses; use open standards where possible

---

## Benefits

1. **Self-Documenting**: `config-not-found` tells you everything; `VF001` tells you nothing
2. **Infinite Scaling**: No ranges to exhaust; just pick a descriptive slug
3. **Stable Identifiers**: Slugs never need renumbering; internal restructuring doesn't break consumers
4. **RFC 9457 Compliance**: Standard HTTP error response shape with `type` URI as primary identifier
5. **Auto-Generated Docs**: `type` URI resolves to documentation explaining how to fix the error
6. **Domain-Based Categories**: Group errors by subsystem, use HTTP status for cross-cutting concerns
7. **HTTP Status Alignment**: Each error maps to an appropriate HTTP status code
8. **Single Source of Truth**: One slug registry replaces two parallel error systems
9. **Error Chaining**: `cause` field captures root cause relationships for debugging
