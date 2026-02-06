# Error Codes Refactoring Plan

## Overview

This plan documents all existing error codes in the Veryfront codebase and proposes a standardized categorization system to improve error handling consistency and developer experience.

---

## Current State Analysis

### Error Code Systems

The codebase currently uses **two parallel error code systems**:

#### 1. VF### Code System (Primary)
- **Location:** `src/errors/error-codes.ts`
- **Format:** `VF###` (e.g., VF001, VF200)
- **Count:** 40+ error codes
- **Auto-generated docs URL:** `https://veryfront.com/docs/errors/{code}`

#### 2. Schema-Based Error Codes
- **Location:** `src/errors/schemas/error.schema.ts`
- **Format:** `UPPER_SNAKE_CASE` (e.g., FILE_NOT_FOUND)
- **Count:** 15 error codes
- **Validated via Zod schema**

---

## Complete Error Code Registry

### Configuration Errors (VF001-VF099)

| Code   | Name                    | Description                          |
|--------|-------------------------|--------------------------------------|
| VF001  | CONFIG_NOT_FOUND        | Configuration file not found         |
| VF002  | CONFIG_INVALID          | Invalid configuration format         |
| VF003  | CONFIG_PARSE_ERROR      | Failed to parse configuration        |
| VF004  | CONFIG_VALIDATION_ERROR | Configuration validation failed      |
| VF005  | CONFIG_TYPE_ERROR       | Configuration type mismatch          |
| VF006  | IMPORT_MAP_INVALID      | Invalid import map configuration     |
| VF007  | CORS_CONFIG_INVALID     | Invalid CORS configuration           |

### Build Errors (VF100-VF199)

| Code   | Name                     | Description                          |
|--------|--------------------------|--------------------------------------|
| VF100  | BUILD_FAILED             | Build process failed                 |
| VF101  | BUNDLE_ERROR             | Bundle generation failed             |
| VF102  | TYPESCRIPT_ERROR         | TypeScript compilation error         |
| VF103  | MDX_COMPILE_ERROR        | MDX compilation failed               |
| VF104  | ASSET_OPTIMIZATION_ERROR | Asset optimization failed            |
| VF105  | SSG_GENERATION_ERROR     | Static site generation failed        |
| VF106  | SOURCEMAP_ERROR          | Source map generation failed         |

### Runtime Errors (VF200-VF299)

| Code   | Name               | Description                          |
|--------|--------------------|--------------------------------------|
| VF200  | HYDRATION_MISMATCH | Client/server hydration mismatch     |
| VF201  | RENDER_ERROR       | Component render failed              |
| VF202  | COMPONENT_ERROR    | Component execution error            |
| VF203  | LAYOUT_NOT_FOUND   | Layout component not found           |
| VF204  | PAGE_NOT_FOUND     | Page component not found             |
| VF205  | API_ERROR          | API route handler error              |
| VF206  | MIDDLEWARE_ERROR   | Middleware execution error           |

### Route Errors (VF300-VF399)

| Code   | Name                  | Description                          |
|--------|-----------------------|--------------------------------------|
| VF300  | ROUTE_CONFLICT        | Conflicting route definitions        |
| VF301  | INVALID_ROUTE_FILE    | Invalid route file structure         |
| VF302  | ROUTE_HANDLER_INVALID | Invalid route handler export         |
| VF303  | DYNAMIC_ROUTE_ERROR   | Dynamic route parsing failed         |
| VF304  | ROUTE_PARAMS_ERROR    | Route parameters invalid             |
| VF305  | API_ROUTE_ERROR       | API route definition error           |

### Module/Import Errors (VF400-VF499)

| Code   | Name                    | Description                          |
|--------|-------------------------|--------------------------------------|
| VF400  | MODULE_NOT_FOUND        | Module could not be resolved         |
| VF401  | IMPORT_RESOLUTION_ERROR | Import path resolution failed        |
| VF402  | CIRCULAR_DEPENDENCY     | Circular dependency detected         |
| VF403  | INVALID_IMPORT          | Invalid import statement             |
| VF404  | DEPENDENCY_MISSING      | Required dependency not installed    |
| VF405  | VERSION_MISMATCH        | Dependency version mismatch          |

### Server Errors (VF500-VF599)

| Code   | Name                | Description                          |
|--------|---------------------|--------------------------------------|
| VF500  | PORT_IN_USE         | Server port already in use           |
| VF501  | SERVER_START_ERROR  | Server failed to start               |
| VF502  | HMR_ERROR           | Hot module replacement error         |
| VF503  | CACHE_ERROR         | Cache operation failed               |
| VF504  | FILE_WATCH_ERROR    | File watcher error                   |
| VF505  | REQUEST_ERROR       | HTTP request handling error          |
| VF506  | SERVICE_OVERLOADED  | Service overloaded                   |
| VF507  | CACHE_PATH_MISMATCH | Cache path mismatch                  |

### RSC/Client Boundary Errors (VF600-VF699)

| Code   | Name                      | Description                          |
|--------|---------------------------|--------------------------------------|
| VF600  | CLIENT_BOUNDARY_VIOLATION | Client boundary rule violation       |
| VF601  | SERVER_ONLY_IN_CLIENT     | Server-only code in client component |
| VF602  | CLIENT_ONLY_IN_SERVER     | Client-only code in server component |
| VF603  | INVALID_USE_CLIENT        | Invalid 'use client' directive       |
| VF604  | INVALID_USE_SERVER        | Invalid 'use server' directive       |
| VF605  | RSC_PAYLOAD_ERROR         | RSC payload serialization error      |

### Development Errors (VF700-VF799)

| Code   | Name                | Description                          |
|--------|---------------------|--------------------------------------|
| VF700  | DEV_SERVER_ERROR    | Development server error             |
| VF701  | FAST_REFRESH_ERROR  | Fast refresh failed                  |
| VF702  | ERROR_OVERLAY_ERROR | Error overlay failed                 |
| VF703  | SOURCE_MAP_ERROR    | Source map loading error             |

### Deployment Errors (VF800-VF899)

| Code   | Name                      | Description                           |
|--------|---------------------------|---------------------------------------|
| VF800  | DEPLOYMENT_ERROR          | Deployment process failed             |
| VF801  | PLATFORM_ERROR            | Platform-specific error               |
| VF802  | ENV_VAR_MISSING           | Required environment variable missing |
| VF803  | PRODUCTION_BUILD_REQUIRED | Production build required             |

### General Errors (VF900-VF999)

| Code   | Name              | Description                          |
|--------|-------------------|--------------------------------------|
| VF900  | UNKNOWN_ERROR     | Unknown/unclassified error           |
| VF901  | PERMISSION_DENIED | File/resource permission denied      |
| VF902  | FILE_NOT_FOUND    | File not found                       |
| VF903  | INVALID_ARGUMENT  | Invalid function argument            |
| VF904  | TIMEOUT_ERROR     | Operation timed out                  |

### Schema-Based Error Codes (error.schema.ts)

| Name                 | Description                          |
|----------------------|--------------------------------------|
| FILE_NOT_FOUND       | File not found                       |
| BUILD_ERROR          | Build process error                  |
| CONFIG_ERROR         | Configuration error                  |
| COMPILATION_ERROR    | Compilation failed                   |
| NETWORK_ERROR        | Network operation failed             |
| PERMISSION_ERROR     | Permission denied                    |
| RENDER_ERROR         | Render failed                        |
| INITIALIZATION_ERROR | Initialization failed                |
| AGENT_ERROR          | Agent operation error                |
| AGENT_NOT_FOUND      | Agent not found                      |
| AGENT_TIMEOUT        | Agent operation timed out            |
| AGENT_INTENT_ERROR   | Agent intent parsing error           |
| ORCHESTRATION_ERROR  | Multi-agent orchestration error      |
| NOT_SUPPORTED        | Feature not supported                |
| SERVICE_OVERLOADED   | Service overloaded                   |

---

## Schema Consolidation Strategy

The two error code systems must be unified. Strategy:

### Primary System: VF### Codes
- VF### codes become the **single source of truth**
- Schema-based codes in `error.schema.ts` will be **deprecated and removed**
- All schema code references migrate to their VF### equivalents

### Migration Mapping

| Schema Code          | Migrates To        | New Code   |
|----------------------|--------------------|------------|
| FILE_NOT_FOUND       | FILE_NOT_FOUND     | VFNOT003   |
| BUILD_ERROR          | BUILD_FAILED       | VFBLD001   |
| CONFIG_ERROR         | CONFIG_INVALID     | VFCFG001   |
| COMPILATION_ERROR    | TYPESCRIPT_ERROR   | VFBLD003   |
| NETWORK_ERROR        | REQUEST_ERROR      | VFNET001   |
| PERMISSION_ERROR     | PERMISSION_DENIED  | VFPRM001   |
| RENDER_ERROR         | RENDER_ERROR       | VFRUN002   |
| INITIALIZATION_ERROR | SERVER_START_ERROR | VFINT002   |
| AGENT_ERROR          | AGENT_ERROR        | VFAGT001   |
| AGENT_NOT_FOUND      | AGENT_NOT_FOUND    | VFNOT005   |
| AGENT_TIMEOUT        | AGENT_TIMEOUT      | VFTMO002   |
| AGENT_INTENT_ERROR   | AGENT_INTENT_ERROR | VFAGT002   |
| ORCHESTRATION_ERROR  | ORCHESTRATION_ERROR| VFAGT003   |
| NOT_SUPPORTED        | NOT_SUPPORTED      | VFAGT004   |
| SERVICE_OVERLOADED   | SERVICE_OVERLOADED | VFNET004   |

### Consolidation Steps
1. Add missing error codes to VF### system
2. Update all imports from `error.schema.ts` to use VF### codes
3. Remove `error.schema.ts` enum (keep Zod validation using VF### codes)
4. Update tests to use new codes

---

## Three-Layer Error Identity Model

Each error has three identifiers for different purposes:

| Layer    | Purpose                  | Example                | Stability  |
|----------|--------------------------|------------------------|------------|
| Slug     | External API, docs URLs  | `config-not-found`     | **Stable** |
| Code     | Logging, debugging       | `VFNOT001`             | May change |
| Category | Filtering, handling      | `NOT_FOUND`            | Stable     |

### Slug as Primary Identifier

The **slug** is the canonical, stable identifier:
- Derived from error name: `CONFIG_NOT_FOUND` → `config-not-found`
- Used in RFC 9457 `type` URI: `https://veryfront.com/docs/errors/config-not-found`
- Never changes, even if internal code changes

This resolves breaking changes: consumers match on slugs, not codes.

### Example Error Identity

```typescript
{
  slug: "config-not-found",      // Stable, used in type URI
  code: "VFNOT001",              // Internal, may change
  category: "NOT_FOUND",         // Grouping
  name: "CONFIG_NOT_FOUND"       // Constant name
}
```

---

## RFC 9457 Compliance

Adopt [RFC 9457 (Problem Details for HTTP APIs)](https://www.rfc-editor.org/rfc/rfc9457) for error responses.

### Response Shape

```json
{
  "type": "https://veryfront.com/docs/errors/config-not-found",
  "title": "Configuration file not found",
  "status": 404,
  "detail": "Could not find veryfront.config.ts in /app/my-project",
  "code": "VFNOT001",
  "category": "NOT_FOUND",
  "suggestion": "Run 'vf init' to create a configuration file"
}
```

### Field Definitions

| Field      | RFC 9457    | Description                                      |
|------------|-------------|--------------------------------------------------|
| type       | Standard    | URI reference identifying the problem type       |
| title      | Standard    | Short, human-readable summary                    |
| status     | Standard    | HTTP status code                                 |
| detail     | Standard    | Human-readable explanation specific to this case |
| code       | Extension   | Internal error code (VFXXX###)                   |
| category   | Extension   | Error category for filtering                     |
| suggestion | Extension   | Actionable fix suggestion                        |

### Benefits
- The `type` URI doubles as documentation URL
- Slug-based URLs survive code renumbering
- Standard format for API consumers
- Extension fields preserve Veryfront-specific context

---

## Proposed Category System

### New Error Categories

| Category   | Prefix   | HTTP Status | Description                         |
|------------|----------|-------------|-------------------------------------|
| VALIDATION | VFVAL    | 400 / 422   | Input/data validation failures      |
| NOT_FOUND  | VFNOT    | 404         | Resource not found errors           |
| PERMISSION | VFPRM    | 403         | Permission & access control errors  |
| NETWORK    | VFNET    | 502 / 503   | Network & connectivity errors       |
| TIMEOUT    | VFTMO    | 408 / 504   | Timeout & deadline exceeded errors  |
| CONFLICT   | VFCON    | 409         | Resource conflict & concurrency     |
| INTERNAL   | VFINT    | 500         | Internal server/system errors       |
| BUILD      | VFBLD    | N/A         | Build & compilation errors          |
| RUNTIME    | VFRUN    | 500         | Runtime execution errors            |
| CONFIG     | VFCFG    | N/A         | Configuration errors                |
| DEV        | VFDEV    | N/A         | Development-only errors             |
| AGENT      | VFAGT    | 500         | AI agent-related errors             |

### Reserved / Future Categories

| Category   | Prefix   | HTTP Status | Description                         |
|------------|----------|-------------|-------------------------------------|
| AUTH       | VFATH    | 401 / 403   | Authentication & authorization      |

> **Note:** AUTH category is reserved for future OAuth/API key flows. Codes will be added when authentication features are implemented.

### Prefix Rationale

All prefixes use readable 3-letter abbreviations:

| Prefix | Derived From | Mnemonic           |
|--------|--------------|-------------------|
| VFVAL  | VALidation   | Validate input    |
| VFNOT  | NOT found    | Not there         |
| VFPRM  | PeRMission   | Permission denied |
| VFNET  | NETwork      | Network issues    |
| VFTMO  | TiMeOut      | Timed out         |
| VFCON  | CONflict     | Conflict detected |
| VFINT  | INTernal     | Internal error    |
| VFBLD  | BuiLD        | Build failed      |
| VFRUN  | RUNtime      | Runtime error     |
| VFCFG  | ConFiG       | Config problem    |
| VFDEV  | DEVelopment  | Dev-only          |
| VFAGT  | AGentT       | Agent error       |
| VFATH  | AuTHenticate | Auth required     |

---

## Category Mapping

### VALIDATION (VFVAL###)
Errors related to invalid input, malformed data, or schema violations.

| New Code  | Name                    | Old Code | Slug                      |
|-----------|-------------------------|----------|---------------------------|
| VFVAL001  | CONFIG_VALIDATION_ERROR | VF004    | config-validation-error   |
| VFVAL002  | CONFIG_TYPE_ERROR       | VF005    | config-type-error         |
| VFVAL003  | INVALID_ROUTE_FILE      | VF301    | invalid-route-file        |
| VFVAL004  | ROUTE_HANDLER_INVALID   | VF302    | route-handler-invalid     |
| VFVAL005  | ROUTE_PARAMS_ERROR      | VF304    | route-params-error        |
| VFVAL006  | INVALID_IMPORT          | VF403    | invalid-import            |
| VFVAL007  | INVALID_USE_CLIENT      | VF603    | invalid-use-client        |
| VFVAL008  | INVALID_USE_SERVER      | VF604    | invalid-use-server        |
| VFVAL009  | INVALID_ARGUMENT        | VF903    | invalid-argument          |
| VFVAL010  | CONFIG_PARSE_ERROR      | VF003    | config-parse-error        |
| VFVAL011  | IMPORT_MAP_INVALID      | VF006    | import-map-invalid        |
| VFVAL012  | CORS_CONFIG_INVALID     | VF007    | cors-config-invalid       |

### NOT_FOUND (VFNOT###)
Resource, file, or entity not found errors.

| New Code  | Name              | Old Code | Slug               |
|-----------|-------------------|----------|--------------------|
| VFNOT001  | CONFIG_NOT_FOUND  | VF001    | config-not-found   |
| VFNOT002  | MODULE_NOT_FOUND  | VF400    | module-not-found   |
| VFNOT003  | FILE_NOT_FOUND    | VF902    | file-not-found     |
| VFNOT004  | LAYOUT_NOT_FOUND  | VF203    | layout-not-found   |
| VFNOT005  | PAGE_NOT_FOUND    | VF204    | page-not-found     |
| VFNOT006  | DEPENDENCY_MISSING| VF404    | dependency-missing |
| VFNOT007  | AGENT_NOT_FOUND   | schema   | agent-not-found    |

### PERMISSION (VFPRM###)
Permission and access control errors.

| New Code  | Name                      | Old Code | Slug                       |
|-----------|---------------------------|----------|----------------------------|
| VFPRM001  | PERMISSION_DENIED         | VF901    | permission-denied          |
| VFPRM002  | CLIENT_BOUNDARY_VIOLATION | VF600    | client-boundary-violation  |
| VFPRM003  | SERVER_ONLY_IN_CLIENT     | VF601    | server-only-in-client      |
| VFPRM004  | CLIENT_ONLY_IN_SERVER     | VF602    | client-only-in-server      |

### NETWORK (VFNET###)
Network, connectivity, and HTTP errors.

| New Code  | Name              | Old Code | Slug               |
|-----------|-------------------|----------|--------------------|
| VFNET001  | REQUEST_ERROR     | VF505    | request-error      |
| VFNET002  | API_ERROR         | VF205    | api-error          |
| VFNET003  | NETWORK_ERROR     | schema   | network-error      |
| VFNET004  | SERVICE_OVERLOADED| VF506    | service-overloaded |

### TIMEOUT (VFTMO###)
Timeout and deadline exceeded errors.

| New Code  | Name          | Old Code | Slug          |
|-----------|---------------|----------|---------------|
| VFTMO001  | TIMEOUT_ERROR | VF904    | timeout-error |
| VFTMO002  | AGENT_TIMEOUT | schema   | agent-timeout |

### CONFLICT (VFCON###)
Resource conflict and concurrency errors.

| New Code  | Name                | Old Code | Slug                |
|-----------|---------------------|----------|---------------------|
| VFCON001  | ROUTE_CONFLICT      | VF300    | route-conflict      |
| VFCON002  | CIRCULAR_DEPENDENCY | VF402    | circular-dependency |
| VFCON003  | VERSION_MISMATCH    | VF405    | version-mismatch    |
| VFCON004  | PORT_IN_USE         | VF500    | port-in-use         |
| VFCON005  | CACHE_PATH_MISMATCH | VF507    | cache-path-mismatch |

### INTERNAL (VFINT###)
Internal system and server errors.

| New Code  | Name                 | Old Code | Slug                 |
|-----------|----------------------|----------|----------------------|
| VFINT001  | UNKNOWN_ERROR        | VF900    | unknown-error        |
| VFINT002  | SERVER_START_ERROR   | VF501    | server-start-error   |
| VFINT003  | MIDDLEWARE_ERROR     | VF206    | middleware-error     |
| VFINT004  | PLATFORM_ERROR       | VF801    | platform-error       |
| VFINT005  | INITIALIZATION_ERROR | schema   | initialization-error |
| VFINT006  | CACHE_ERROR          | VF503    | cache-error          |
| VFINT007  | DEPLOYMENT_ERROR     | VF800    | deployment-error     |

### BUILD (VFBLD###)
Build, compilation, and bundling errors.

| New Code  | Name                     | Old Code | Slug                     |
|-----------|--------------------------|----------|--------------------------|
| VFBLD001  | BUILD_FAILED             | VF100    | build-failed             |
| VFBLD002  | BUNDLE_ERROR             | VF101    | bundle-error             |
| VFBLD003  | TYPESCRIPT_ERROR         | VF102    | typescript-error         |
| VFBLD004  | MDX_COMPILE_ERROR        | VF103    | mdx-compile-error        |
| VFBLD005  | ASSET_OPTIMIZATION_ERROR | VF104    | asset-optimization-error |
| VFBLD006  | SSG_GENERATION_ERROR     | VF105    | ssg-generation-error     |
| VFBLD007  | SOURCEMAP_ERROR          | VF106    | sourcemap-error          |
| VFBLD008  | COMPILATION_ERROR        | schema   | compilation-error        |
| VFBLD009  | DYNAMIC_ROUTE_ERROR      | VF303    | dynamic-route-error      |
| VFBLD010  | API_ROUTE_ERROR          | VF305    | api-route-error          |
| VFBLD011  | IMPORT_RESOLUTION_ERROR  | VF401    | import-resolution-error  |

### RUNTIME (VFRUN###)
Runtime execution and rendering errors (production).

| New Code  | Name               | Old Code | Slug               |
|-----------|--------------------|----------|--------------------|
| VFRUN001  | HYDRATION_MISMATCH | VF200    | hydration-mismatch |
| VFRUN002  | RENDER_ERROR       | VF201    | render-error       |
| VFRUN003  | COMPONENT_ERROR    | VF202    | component-error    |
| VFRUN004  | RSC_PAYLOAD_ERROR  | VF605    | rsc-payload-error  |

### DEV (VFDEV###)
Development-only errors (not production).

| New Code  | Name                | Old Code | Slug                |
|-----------|---------------------|----------|---------------------|
| VFDEV001  | DEV_SERVER_ERROR    | VF700    | dev-server-error    |
| VFDEV002  | FAST_REFRESH_ERROR  | VF701    | fast-refresh-error  |
| VFDEV003  | ERROR_OVERLAY_ERROR | VF702    | error-overlay-error |
| VFDEV004  | SOURCE_MAP_ERROR    | VF703    | source-map-error    |
| VFDEV005  | HMR_ERROR           | VF502    | hmr-error           |
| VFDEV006  | FILE_WATCH_ERROR    | VF504    | file-watch-error    |

### CONFIG (VFCFG###)
Configuration and environment errors.

| New Code  | Name                      | Old Code | Slug                      |
|-----------|---------------------------|----------|---------------------------|
| VFCFG001  | CONFIG_INVALID            | VF002    | config-invalid            |
| VFCFG002  | ENV_VAR_MISSING           | VF802    | env-var-missing           |
| VFCFG003  | PRODUCTION_BUILD_REQUIRED | VF803    | production-build-required |

### AGENT (VFAGT###)
AI agent and orchestration errors.

| New Code  | Name                | Old Code | Slug                |
|-----------|---------------------|----------|---------------------|
| VFAGT001  | AGENT_ERROR         | schema   | agent-error         |
| VFAGT002  | AGENT_INTENT_ERROR  | schema   | agent-intent-error  |
| VFAGT003  | ORCHESTRATION_ERROR | schema   | orchestration-error |
| VFAGT004  | NOT_SUPPORTED       | schema   | not-supported       |

---

## Error Code Lifecycle

### Adding a New Error Code

1. **Determine category** — Which category does this error belong to?
2. **Assign code** — Use next available number in category (e.g., VFBLD012)
3. **Create slug** — Derive from name: `NEW_ERROR_NAME` → `new-error-name`
4. **Add to registry** — Update `src/errors/error-codes.ts`
5. **Add solution** — Create entry in appropriate catalog file
6. **Add documentation** — Create docs page at `/docs/errors/{slug}`
7. **Add tests** — Unit test for error creation and handling

### Deprecating an Error Code

1. Mark as deprecated in registry with replacement code
2. Log deprecation warning when error is thrown
3. Update documentation with migration guidance
4. Remove after 2 major versions

### Renumbering Codes

Since slugs are the stable identifier:
1. Update internal code number
2. Update old→new mapping table
3. No changes needed for consumers using slug-based `type` URIs

---

## Implementation Plan

### Phase 1: Schema Definition
- [ ] Create `ErrorCategory` enum in `src/errors/schemas/error.schema.ts`
- [ ] Add `slug` field to `VeryfrontError` class
- [ ] Add `category` field to `VeryfrontError` class
- [ ] Update Zod schema to include category and slug validation
- [ ] Add slug generation utility: `generateSlug(name: string): string`

### Phase 2: Code Migration
- [ ] Update `src/errors/error-codes.ts` with new VFXXX### format
- [ ] Add slug to each error code definition
- [ ] Replace all old VF### codes with new category-prefixed codes
- [ ] Update all references throughout the codebase
- [ ] Remove deprecated schema-based error codes

### Phase 3: Error Class Updates
- [ ] Add category and slug properties to all error classes
- [ ] Update error constructors to derive slug from name
- [ ] Add helper functions for category-based error filtering
- [ ] Implement RFC 9457 `toProblemDetails()` method

### Phase 4: Catalog Updates
- [ ] Reorganize error catalogs by category
- [ ] Update error solution lookup to use slugs
- [ ] Add category-based search functionality

### Phase 5: Documentation
- [ ] Update error docs URL generator to use slugs
- [ ] Set up redirects: `/docs/errors/VF001` → `/docs/errors/config-not-found`
- [ ] Create category-based error documentation
- [ ] Document RFC 9457 response format for API consumers

### Phase 6: Testing
- [ ] Add unit tests for category validation
- [ ] Add unit tests for slug generation
- [ ] Add unit tests for RFC 9457 serialization
- [ ] Update existing error tests
- [ ] Add integration tests for new error codes

---

## File Changes Required

| File                                    | Changes                                         |
|-----------------------------------------|-------------------------------------------------|
| `src/errors/schemas/error.schema.ts`    | Add ErrorCategory enum, slug field, update codes|
| `src/errors/error-codes.ts`             | New VFXXX### codes with slugs                   |
| `src/errors/types.ts`                   | Add category, slug to VeryfrontError            |
| `src/errors/veryfront-error.ts`         | Add toProblemDetails(), update VeryfrontErrorData|
| `src/errors/catalog/*.ts`               | Reorganize by category                          |
| `src/errors/agent-errors.ts`            | Add AGENT category                              |
| `src/errors/build-errors.ts`            | Add BUILD category                              |
| `src/errors/runtime-errors.ts`          | Add RUNTIME category                            |
| `src/errors/system-errors.ts`           | Add appropriate categories                      |
| `src/errors/index.ts`                   | Export new category types, slug utilities       |

---

## Design Principles

1. **Fail Fast**: Error early at the point of failure, don't let invalid state propagate
2. **No Unnecessary Fallbacks**: Avoid silent fallbacks that mask real issues — if something fails, surface it immediately
3. **Explicit Over Implicit**: Throw explicit errors rather than returning default values or empty states
4. **Clear Root Cause**: Error messages should identify the exact cause, not symptoms
5. **Actionable Errors**: Every error should tell the developer what went wrong and how to fix it
6. **Standards Compliant**: Follow RFC 9457 for HTTP error responses

---

## Benefits

1. **Semantic Clarity**: Category prefixes immediately convey error type
2. **Better Filtering**: Easy to filter/group errors by category
3. **Consistent Handling**: Similar errors handled uniformly
4. **Future-Proof**: Room for new error codes within each category
5. **Developer Experience**: Clearer error messages and debugging
6. **API Design**: HTTP status code alignment per RFC 9457
7. **Stable URLs**: Slug-based documentation URLs survive code changes
8. **Standards Compliance**: RFC 9457 compatibility for API consumers
