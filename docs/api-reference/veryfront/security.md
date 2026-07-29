---
title: "veryfront/security"
description: "Security layer - input validation with size limits, CORS configuration, CSP and security headers, path traversal prevention, and secure filesystem access."
order: 31
---

## Import

```ts
import {
  applyCORSHeaders,
  applyCORSHeadersSync,
  applyCsrfCookie,
  applySecurityHeaders,
  buildCacheControl,
  cors,
} from "veryfront/security";
```

## Examples

### Apply response security headers

```ts
import { applySecurityHeaders, generateNonce } from "veryfront/security";

const response = new Response("Ready");
applySecurityHeaders(response.headers, false, generateNonce(), null);
```

## Exports

### Components

| Name | Description | Source |
|------|-------------|--------|
| `CommonSchemas` | Lazy-getter object that preserves the `CommonSchemas.email` call shape. Each access returns the cached `Schema<T>` (memoized inside `defineSchema`), so chained calls like `CommonSchemas.email.parse(x)` work as before. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L91) |
| `PathValidationError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/path-validation/types.ts#L27) |
| `ValidationPresets` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/path-validation/presets.ts#L45) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `applyCORSHeaders` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/http/cors/headers.ts#L81) |
| `applyCORSHeadersSync` | Apply CORS synchronously. The existing CORSHeaderOptions signature remains broad for source compatibility; async validators are denied at runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/http/cors/headers.ts#L110) |
| `applyCsrfCookie` | Set CSRF cookie on GET/HEAD responses when not already present. Uses httpOnly: false so client JS can read the cookie for double-submit. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/csrf/helpers.ts#L150) |
| `applySecurityHeaders` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/http/response/security-handler.ts#L179) |
| `buildCacheControl` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/http/response/cache-handler.ts#L15) |
| `cors` | Create CORS middleware. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/http/cors/middleware.ts#L10) |
| `corsSimple` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/http/cors/middleware.ts#L39) |
| `createResponseBuilder` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/http/response/builder.ts#L60) |
| `createSecureFs` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/secure-fs.ts#L472) |
| `createValidatedHandler` | Create a validated API handler wrapper that auto-validates body/query with Zod schemas | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/input-validation/handler.ts#L21) |
| `createValidationError` | Create an input validation error. Convenience wrapper around INPUT_VALIDATION_FAILED.create(). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/input-validation/errors.ts#L12) |
| `createValidator` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/path-validation/index.ts#L144) |
| `generateCsrfToken` | Generate a CSRF token and return value + Set-Cookie header string | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/csrf/helpers.ts#L70) |
| `generateNonce` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/http/response/security-handler.ts#L44) |
| `getSecurityHeader` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/http/response/security-handler.ts#L166) |
| `handleCORSPreflight` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/http/cors/preflight.ts#L126) |
| `isPreflightRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/http/cors/preflight.ts#L186) |
| `isRequestBodyTooLargeError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/input-validation/limits.ts#L50) |
| `isValidSecurityConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/http/middleware/config-loader.ts#L6) |
| `loadSecurityConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/http/middleware/config-loader.ts#L34) |
| `parseFormData` | Parse and validate multipart or URL-encoded form data. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/input-validation/parsers.ts#L75) |
| `parseJsonBody` | Parse and validate a JSON request body. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/input-validation/parsers.ts#L17) |
| `parseQueryParams` | Parse and validate query parameters from a request URL. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/input-validation/parsers.ts#L123) |
| `readBodyWithLimit` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/input-validation/limits.ts#L179) |
| `sanitizeData` | Sanitize data to prevent XSS and prototype pollution attacks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/input-validation/sanitizers.ts#L2) |
| `sanitizePathForDisplay` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/path-validation/index.ts#L151) |
| `setCors` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/http/middleware/cors-handler.ts#L4) |
| `shouldApplyCORS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/http/cors/headers.ts#L128) |
| `validateCORSConfig` | Validate CORS configuration for security issues. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/http/cors/validators.ts#L423) |
| `validateCsrf` | Validate CSRF token by comparing header and cookie | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/csrf/helpers.ts#L119) |
| `validateOrigin` | Validate origin against CORS configuration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/http/cors/validators.ts#L392) |
| `validateOriginSync` | Synchronous origin validation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/http/cors/validators.ts#L413) |
| `validatePath` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/path-validation/index.ts#L71) |
| `validatePathSync` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/path-validation/index.ts#L128) |
| `validateRequestLimits` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/input-validation/limits.ts#L56) |
| `wrapAdapterWithSecurity` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/secure-fs.ts#L476) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `AuthHandler` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/http/auth.ts#L107) |
| `BaseHandler` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/http/base-handler.ts#L44) |
| `CsrfHandler` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/http/csrf/csrf-handler.ts#L63) |
| `ResponseBuilder` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/http/response/builder.ts#L9) |
| `SecureFs` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/secure-fs.ts#L192) |
| `SecurityConfigLoader` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/http/config.ts#L92) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `CacheStrategy` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/http/response/types.ts#L11) |
| `CORSConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/http/middleware/types.ts#L1) |
| `CORSHeaderOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/http/cors/types.ts#L34) |
| `CORSOptions` | CORS policy accepted by asynchronous middleware and preflight APIs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/http/cors/types.ts#L7) |
| `CORSPreflightOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/http/cors/types.ts#L27) |
| `CORSValidationResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/http/cors/types.ts#L21) |
| `CSPDirectives` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/http/middleware/types.ts#L10) |
| `CsrfConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/csrf/helpers.ts#L20) |
| `CsrfTokenOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/csrf/helpers.ts#L27) |
| `HandlerHelpers` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/http/base-handler.ts#L18) |
| `OriginValidator` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/http/cors/types.ts#L2) |
| `ParseFormOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/input-validation/types.ts#L27) |
| `ParseJsonOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/input-validation/types.ts#L22) |
| `RequestLimits` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/input-validation/types.ts#L8) |
| `ResponseBuilderConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/http/response/types.ts#L27) |
| `SecureFsConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/secure-fs.ts#L48) |
| `SecurityConfig` | HTTP security controls resolved for a project runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/types/server.ts#L9) |
| `SecurityContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/secure-fs.ts#L31) |
| `SecurityEvent` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/secure-fs.ts#L58) |
| `SyncCORSConfig` | CORS policy accepted by synchronous response-building APIs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/http/cors/types.ts#L17) |
| `SyncCORSHeaderOptions` | Header options accepted by synchronous CORS response helpers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/http/cors/types.ts#L42) |
| `SyncOriginValidator` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/http/cors/types.ts#L1) |
| `ValidatedData` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/input-validation/types.ts#L31) |
| `ValidatedHandlerConfig` | Configuration for `createValidatedHandler()`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/input-validation/handler.ts#L8) |
| `ValidatedHandlerFunction` | Handler signature that receives validated request data. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/input-validation/handler.ts#L15) |
| `ValidationLevel` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/path-validation/types.ts#L8) |
| `ValidationOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/path-validation/types.ts#L17) |
| `ValidationResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/path-validation/types.ts#L10) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `BUILD_HELPER_PERMISSIONS` | BUILD_HELPER - manifest generators, framework source prep. Only needs filesystem + env access. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/deno-permissions.ts#L48) |
| `CACHE_DURATIONS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/http/response/constants.ts#L10) |
| `CORS_MAX_AGE` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/http/cors/constants.ts#L28) |
| `DEFAULT_CORS_HEADERS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/http/cors/constants.ts#L18) |
| `DEFAULT_CORS_METHODS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/http/cors/constants.ts#L17) |
| `DEFAULT_LIMITS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/input-validation/types.ts#L15) |
| `INPUT_VALIDATION_FAILED` | HTTP request input validation failures (replaces ValidationError) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/general.ts#L77) |
| `SECURITY_VIOLATION` | Path traversal / secure-fs violations (replaces SecurityError) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/general.ts#L68) |
| `SERVER_PERMISSIONS` | SERVER - CLI server (dev, production, proxy, MCP, split-mode). Also used by build and test tasks that need equivalent access. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/deno-permissions.ts#L14) |
| `WORKFLOW_RUN_PERMISSIONS` | WORKFLOW_RUN - `ProcessRunExecutor` (RESTRICTED). Runs user-authored code - no `--allow-run`, `--allow-ffi`, or `--allow-sys`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/deno-permissions.ts#L37) |
