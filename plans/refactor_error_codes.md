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

| Code   | Name              | Description                          |
|--------|-------------------|--------------------------------------|
| VF200  | HYDRATION_MISMATCH| Client/server hydration mismatch     |
| VF201  | RENDER_ERROR      | Component render failed              |
| VF202  | COMPONENT_ERROR   | Component execution error            |
| VF203  | LAYOUT_NOT_FOUND  | Layout component not found           |
| VF204  | PAGE_NOT_FOUND    | Page component not found             |
| VF205  | API_ERROR         | API route handler error              |
| VF206  | MIDDLEWARE_ERROR  | Middleware execution error           |

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

| Code   | Name                     | Description                          |
|--------|--------------------------|--------------------------------------|
| VF600  | CLIENT_BOUNDARY_VIOLATION| Client boundary rule violation       |
| VF601  | SERVER_ONLY_IN_CLIENT    | Server-only code in client component |
| VF602  | CLIENT_ONLY_IN_SERVER    | Client-only code in server component |
| VF603  | INVALID_USE_CLIENT       | Invalid 'use client' directive       |
| VF604  | INVALID_USE_SERVER       | Invalid 'use server' directive       |
| VF605  | RSC_PAYLOAD_ERROR        | RSC payload serialization error      |

### Development Errors (VF700-VF799)

| Code   | Name                | Description                          |
|--------|---------------------|--------------------------------------|
| VF700  | DEV_SERVER_ERROR    | Development server error             |
| VF701  | FAST_REFRESH_ERROR  | Fast refresh failed                  |
| VF702  | ERROR_OVERLAY_ERROR | Error overlay failed                 |
| VF703  | SOURCE_MAP_ERROR    | Source map loading error             |

### Deployment Errors (VF800-VF899)

| Code   | Name                     | Description                          |
|--------|--------------------------|--------------------------------------|
| VF800  | DEPLOYMENT_ERROR         | Deployment process failed            |
| VF801  | PLATFORM_ERROR           | Platform-specific error              |
| VF802  | ENV_VAR_MISSING          | Required environment variable missing|
| VF803  | PRODUCTION_BUILD_REQUIRED| Production build required            |

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

## Proposed Category System

### New Error Categories

The following semantic categories will provide a clearer classification across all error codes:

| Category       | Code Range | Description                                      |
|----------------|------------|--------------------------------------------------|
| VALIDATION     | VFV###     | Input/data validation failures                   |
| AUTH           | VFA###     | Authentication & authorization errors            |
| NOT_FOUND      | VFN###     | Resource not found errors                        |
| PERMISSION     | VFP###     | Permission & access control errors               |
| NETWORK        | VFW###     | Network & connectivity errors                    |
| TIMEOUT        | VFT###     | Timeout & deadline exceeded errors               |
| CONFLICT       | VFC###     | Resource conflict & concurrency errors           |
| INTERNAL       | VFI###     | Internal server/system errors                    |
| BUILD          | VFB###     | Build & compilation errors                       |
| RUNTIME        | VFR###     | Runtime execution errors                         |
| CONFIG         | VFG###     | Configuration errors                             |
| AGENT          | VFE###     | AI agent-related errors                          |

### Category Mapping

#### VALIDATION (VFV###)
Errors related to invalid input, malformed data, or schema violations.

```
VFV001 - CONFIG_VALIDATION_ERROR    (was VF004)
VFV002 - CONFIG_TYPE_ERROR          (was VF005)
VFV003 - INVALID_ROUTE_FILE         (was VF301)
VFV004 - ROUTE_HANDLER_INVALID      (was VF302)
VFV005 - ROUTE_PARAMS_ERROR         (was VF304)
VFV006 - INVALID_IMPORT             (was VF403)
VFV007 - INVALID_USE_CLIENT         (was VF603)
VFV008 - INVALID_USE_SERVER         (was VF604)
VFV009 - INVALID_ARGUMENT           (was VF903)
VFV010 - CONFIG_PARSE_ERROR         (was VF003)
VFV011 - IMPORT_MAP_INVALID         (was VF006)
VFV012 - CORS_CONFIG_INVALID        (was VF007)
```

#### AUTH (VFA###)
Authentication and authorization errors (currently not present, reserved for future use).

```
VFA001 - AUTH_REQUIRED              (new)
VFA002 - AUTH_INVALID_TOKEN         (new)
VFA003 - AUTH_TOKEN_EXPIRED         (new)
VFA004 - AUTH_INSUFFICIENT_SCOPE    (new)
VFA005 - AUTH_PROVIDER_ERROR        (new)
VFA006 - OAUTH_CALLBACK_ERROR       (new)
VFA007 - SESSION_EXPIRED            (new)
VFA008 - API_KEY_INVALID            (new)
```

#### NOT_FOUND (VFN###)
Resource, file, or entity not found errors.

```
VFN001 - CONFIG_NOT_FOUND           (was VF001)
VFN002 - MODULE_NOT_FOUND           (was VF400)
VFN003 - LAYOUT_NOT_FOUND           (was VF203)
VFN004 - PAGE_NOT_FOUND             (was VF204)
VFN005 - FILE_NOT_FOUND             (was VF902)
VFN006 - DEPENDENCY_MISSING         (was VF404)
VFN007 - AGENT_NOT_FOUND            (schema)
```

#### PERMISSION (VFP###)
Permission and access control errors.

```
VFP001 - PERMISSION_DENIED          (was VF901)
VFP002 - CLIENT_BOUNDARY_VIOLATION  (was VF600)
VFP003 - SERVER_ONLY_IN_CLIENT      (was VF601)
VFP004 - CLIENT_ONLY_IN_SERVER      (was VF602)
```

#### NETWORK (VFW###)
Network, connectivity, and HTTP errors.

```
VFW001 - REQUEST_ERROR              (was VF505)
VFW002 - API_ERROR                  (was VF205)
VFW003 - NETWORK_ERROR              (schema)
VFW004 - SERVICE_OVERLOADED         (was VF506)
```

#### TIMEOUT (VFT###)
Timeout and deadline exceeded errors.

```
VFT001 - TIMEOUT_ERROR              (was VF904)
VFT002 - AGENT_TIMEOUT              (schema)
```

#### CONFLICT (VFC###)
Resource conflict and concurrency errors.

```
VFC001 - ROUTE_CONFLICT             (was VF300)
VFC002 - CIRCULAR_DEPENDENCY        (was VF402)
VFC003 - VERSION_MISMATCH           (was VF405)
VFC004 - PORT_IN_USE                (was VF500)
VFC005 - CACHE_PATH_MISMATCH        (was VF507)
```

#### INTERNAL (VFI###)
Internal system and server errors.

```
VFI001 - UNKNOWN_ERROR              (was VF900)
VFI002 - SERVER_START_ERROR         (was VF501)
VFI003 - MIDDLEWARE_ERROR           (was VF206)
VFI004 - PLATFORM_ERROR             (was VF801)
VFI005 - DEV_SERVER_ERROR           (was VF700)
VFI006 - INITIALIZATION_ERROR       (schema)
```

#### BUILD (VFB###)
Build, compilation, and bundling errors.

```
VFB001 - BUILD_FAILED               (was VF100)
VFB002 - BUNDLE_ERROR               (was VF101)
VFB003 - TYPESCRIPT_ERROR           (was VF102)
VFB004 - MDX_COMPILE_ERROR          (was VF103)
VFB005 - ASSET_OPTIMIZATION_ERROR   (was VF104)
VFB006 - SSG_GENERATION_ERROR       (was VF105)
VFB007 - SOURCEMAP_ERROR            (was VF106)
VFB008 - COMPILATION_ERROR          (schema)
VFB009 - SOURCE_MAP_ERROR           (was VF703)
```

#### RUNTIME (VFR###)
Runtime execution and rendering errors.

```
VFR001 - HYDRATION_MISMATCH         (was VF200)
VFR002 - RENDER_ERROR               (was VF201)
VFR003 - COMPONENT_ERROR            (was VF202)
VFR004 - DYNAMIC_ROUTE_ERROR        (was VF303)
VFR005 - API_ROUTE_ERROR            (was VF305)
VFR006 - RSC_PAYLOAD_ERROR          (was VF605)
VFR007 - HMR_ERROR                  (was VF502)
VFR008 - FAST_REFRESH_ERROR         (was VF701)
VFR009 - ERROR_OVERLAY_ERROR        (was VF702)
```

#### CONFIG (VFG###)
Configuration and environment errors.

```
VFG001 - CONFIG_INVALID             (was VF002)
VFG002 - ENV_VAR_MISSING            (was VF802)
VFG003 - PRODUCTION_BUILD_REQUIRED  (was VF803)
VFG004 - IMPORT_RESOLUTION_ERROR    (was VF401)
```

#### AGENT (VFE###)
AI agent and orchestration errors.

```
VFE001 - AGENT_ERROR                (schema)
VFE002 - AGENT_INTENT_ERROR         (schema)
VFE003 - ORCHESTRATION_ERROR        (schema)
VFE004 - NOT_SUPPORTED              (schema)
```

#### OTHER
Errors that don't fit other categories or require special handling.

```
VFX001 - CACHE_ERROR                (was VF503)
VFX002 - FILE_WATCH_ERROR           (was VF504)
VFX003 - DEPLOYMENT_ERROR           (was VF800)
```

---

## Implementation Plan

### Phase 1: Schema Definition
- [ ] Create `ErrorCategory` enum in `src/errors/schemas/error.schema.ts`
- [ ] Add category field to `VeryfrontError` class
- [ ] Update Zod schema to include category validation

### Phase 2: Code Migration
- [ ] Update `src/errors/error-codes.ts` with new code format
- [ ] Replace all old VF### codes with new category-prefixed codes
- [ ] Update all references throughout the codebase

### Phase 3: Error Class Updates
- [ ] Add category property to all error classes
- [ ] Update error constructors to accept category
- [ ] Add helper functions for category-based error filtering

### Phase 4: Catalog Updates
- [ ] Reorganize error catalogs by category
- [ ] Update error solution lookup to use categories
- [ ] Add category-based search functionality

### Phase 5: Documentation
- [ ] Update error docs URL generator for new codes
- [ ] Create category-based error documentation
- [ ] Add migration guide for existing users

### Phase 6: Testing
- [ ] Add unit tests for category validation
- [ ] Update existing error tests
- [ ] Add integration tests for new error codes

---

## File Changes Required

| File                                    | Changes                                    |
|-----------------------------------------|--------------------------------------------|
| `src/errors/schemas/error.schema.ts`    | Add ErrorCategory enum, update ErrorCode   |
| `src/errors/error-codes.ts`             | New category-based code structure          |
| `src/errors/types.ts`                   | Add category to VeryfrontError             |
| `src/errors/veryfront-error.ts`         | Update VeryfrontErrorData                  |
| `src/errors/catalog/*.ts`               | Reorganize by category                     |
| `src/errors/agent-errors.ts`            | Add AGENT category                         |
| `src/errors/build-errors.ts`            | Add BUILD category                         |
| `src/errors/runtime-errors.ts`          | Add RUNTIME category                       |
| `src/errors/system-errors.ts`           | Add appropriate categories                 |
| `src/errors/index.ts`                   | Export new category types                  |

---

## Design Principles

1. **Fail Fast**: Error early at the point of failure, don't let invalid state propagate
2. **No Unnecessary Fallbacks**: Avoid silent fallbacks that mask real issues — if something fails, surface it immediately
3. **Explicit Over Implicit**: Throw explicit errors rather than returning default values or empty states
4. **Clear Root Cause**: Error messages should identify the exact cause, not symptoms
5. **Actionable Errors**: Every error should tell the developer what went wrong and how to fix it

---

## Benefits

1. **Semantic Clarity**: Category prefixes immediately convey error type
2. **Better Filtering**: Easy to filter/group errors by category
3. **Consistent Handling**: Similar errors handled uniformly
4. **Future-Proof**: Room for new error codes within each category
5. **Developer Experience**: Clearer error messages and debugging
6. **API Design**: HTTP status code alignment (NOT_FOUND → 404, AUTH → 401/403)

---

## Notes

- Current schema error codes (15) should be consolidated with VF### system
- AUTH category is new and should be implemented for OAuth/API key flows
- Consider adding HTTP status code mapping for each category
