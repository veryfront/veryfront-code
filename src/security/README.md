# Security API reference

The `veryfront/security` entry point provides request validation, HTTP security,
CSRF protection, response construction, path validation, secure filesystem
access, and Deno permission profiles.

```ts
import {
  applyCORSHeaders,
  createResponseBuilder,
  createValidatedHandler,
  generateCsrfToken,
  validatePath,
} from "veryfront/security";
```

The sandbox, client HTML validation, and `security/rate-limit` directories are
framework internals. They are not public package subpaths. Application rate
limiting is exported from `veryfront/middleware`.

## Input validation

| Export                   | Contract                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| `validateRequestLimits`  | Validates URL, declared body, and header byte limits. Malformed `Content-Length` values are rejected.  |
| `readBodyWithLimit`      | Reads a streamed body and stops once the byte limit is exceeded.                                       |
| `parseJsonBody`          | Reads bounded JSON, optionally sanitizes it, and validates it with a schema.                           |
| `parseFormData`          | Reads bounded form data and enforces file-size limits.                                                 |
| `parseQueryParams`       | Validates URL search parameters with a schema.                                                         |
| `sanitizeData`           | Recursively removes prototype-pollution keys and rejects cyclic or excessively deep input.             |
| `createValidatedHandler` | Wraps an HTTP handler with body and query validation. Validation failures return JSON with status 400. |
| `DEFAULT_LIMITS`         | Default request and file byte limits.                                                                  |
| `CommonSchemas`          | Shared schemas for common request values.                                                              |

Configured limits must be non-negative safe integers. Body and file limits are
enforced while data is read, including requests without `Content-Length`.

## Security configuration

`SecurityConfig` supports these fields:

| Field         | Value                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------- |
| `auth`        | Basic and bearer credentials. Configured credentials must be non-empty.                  |
| `cors`        | `boolean` or a `CORSConfig` object. Wildcard origin cannot be combined with credentials. |
| `csrf`        | `boolean` or `CsrfConfig`.                                                               |
| `csp`         | CSP directive names mapped to a string or string array.                                  |
| `coop`        | `same-origin`, `same-origin-allow-popups`, or `unsafe-none`.                             |
| `corp`        | `same-origin`, `same-site`, or `cross-origin`.                                           |
| `coep`        | `require-corp` or `unsafe-none`.                                                         |
| `hsts`        | HSTS `maxAge` and optional `includeSubDomains` and `preload` flags.                      |
| `headers`     | Additional HTTP header names and values.                                                 |
| `remoteHosts` | URL strings used by runtime integrations.                                                |

`isValidSecurityConfig` performs runtime validation. `SecurityConfigLoader`
loads and caches project configuration, defaults CSRF protection on in
production, and fails the current request when loading or validation fails.

## CORS

The public CORS surface includes middleware, preflight handling, header
application, origin validation, and constants:

- `cors` and `corsSimple`
- `handleCORSPreflight` and `isPreflightRequest`
- `applyCORSHeaders` and `applyCORSHeadersSync`
- `validateOrigin`, `validateOriginSync`, and `validateCORSConfig`
- `DEFAULT_CORS_METHODS`, `DEFAULT_CORS_HEADERS`, and `CORS_MAX_AGE`

Origin callbacks may return a boolean or a response origin string. Async
callbacks require the asynchronous APIs. Invalid configuration and callback
errors deny the origin. Preflight handling rejects request methods and headers
outside their configured allowlists. CORS middleware leaves WebSocket upgrade
responses unchanged.

## CSRF

`generateCsrfToken` creates a 32-byte random token encoded as unpadded
base64url and returns its `Set-Cookie` value. `validateCsrf` implements the
double-submit cookie comparison. `applyCsrfCookie` issues a readable token
cookie for eligible HTML `GET` and `HEAD` responses.

The default cookie name is `__Host-vf_csrf`, the default request header is
`x-csrf-token`, and the default lifetime is 24 hours. Custom cookie and header
names must be valid HTTP tokens. `__Host-` and `__Secure-` cookie names always
receive the `Secure` attribute.

`CsrfHandler` enforces configured CSRF protection on unsafe HTTP methods.

## Responses and security headers

`ResponseBuilder` and `createResponseBuilder` build JSON, text, HTML,
JavaScript, streaming, and preflight responses. Fluent methods apply CORS,
security headers, cache policy, ETags, status, and custom headers.

`applySecurityHeaders` applies CSP and standard response protections.
`generateNonce` creates a CSP nonce. `buildCacheControl` accepts a named
`CacheStrategy` or an explicit duration object. Unknown presets and invalid
durations are rejected.

## Path and filesystem safety

`validatePath` performs asynchronous lexical and physical containment checks.
Use it when symlinks or file existence matter. `validatePathSync` performs
lexical validation only. Both return a `ValidationResult`; they do not throw for
ordinary invalid-path results.

`ValidationPresets`, `createValidator`, `PathValidationError`, and
`sanitizePathForDisplay` support consistent policy and safe reporting.

`SecureFs` validates paths before filesystem operations. `createSecureFs`
constructs an instance and `wrapAdapterWithSecurity` installs it on a runtime
adapter. Temporary directories are created inside the configured base. The
unsafe adapter escape hatch is available only when `NODE_ENV` is exactly
`development` or `test`.

## Permission profiles

The public constants `SERVER_PERMISSIONS`, `WORKFLOW_RUN_PERMISSIONS`, and
`BUILD_HELPER_PERMISSIONS` define Deno CLI flags for their named execution
contexts. Workflow permissions are intended for trusted local code and are not
a secret-isolation boundary.

## Verification

Run the complete module tests from the repository root:

```sh
VF_DISABLE_LRU_INTERVAL=1 SSR_TRANSFORM_PER_PROJECT_LIMIT=0 \
  REVALIDATION_PER_PROJECT_LIMIT=0 NODE_ENV=production LOG_FORMAT=text \
  deno test --no-check --allow-all --unstable-worker-options --unstable-net \
  src/security
```
