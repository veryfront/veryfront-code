# Security module reference

`src/security` owns Veryfront's request-security primitives and the internal
worker boundary used to run project code. Its only published package entrypoint
is `veryfront/security`, mapped to [`index.ts`](./index.ts).

This module does not provide password hashing, JWT verification, SQL escaping,
or a public sandbox API. Authentication here is limited to the runtime's Basic
and bearer-token request gate. Public rate limiting belongs to
[`veryfront/middleware`](../middleware/README.md).

## Published surface

The root entrypoint exports the following groups:

| Area | Runtime exports |
| --- | --- |
| HTTP handlers | `BaseHandler`, `AuthHandler`, `CsrfHandler`, `SecurityConfigLoader` |
| Input boundaries | `validateRequestLimits`, `readBodyWithLimit`, `parseJsonBody`, `parseFormData`, `parseQueryParams`, `createValidatedHandler`, `sanitizeData` |
| CORS | `cors`, `corsSimple`, `validateOrigin`, `validateOriginSync`, `applyCORSHeaders`, `applyCORSHeadersSync`, `handleCORSPreflight` |
| CSRF | `generateCsrfToken`, `validateCsrf`, `applyCsrfCookie` |
| Responses | `ResponseBuilder`, `createResponseBuilder`, `applySecurityHeaders`, `buildCacheControl`, `generateNonce` |
| Paths and files | `validatePath`, `validatePathSync`, `createValidator`, `createSecureFs`, `SecureFs`, `wrapAdapterWithSecurity` |
| Deno permissions | `BUILD_HELPER_PERMISSIONS`, `SERVER_PERMISSIONS`, `WORKFLOW_RUN_PERMISSIONS` |

Types are exported beside their owning runtime contracts. The exact runtime
inventory is regression-pinned in [`index.test.ts`](./index.test.ts); adding or
removing a root export is an intentional package-surface change.

## Policy ownership

### Configuration

Project security configuration is validated by the canonical configuration
schema before `SecurityConfigLoader` derives a request-owned, frozen security
context. Production derivation enables the default CSRF policy when the project
does not specify one. A failed configuration load fails the current request and
remains retryable for a later request.

### CORS

CORS policy owns every `Access-Control-*` response header. Runtime helpers
snapshot and validate their configuration, reject wildcard origins combined
with credentials, bound all reflected lists, and fail closed when an origin
validator throws or returns an invalid value.

Use the asynchronous helpers when an origin validator can return a promise.
The synchronous helpers deliberately deny promise-returning validators.

### CSRF

CSRF uses a double-submit cookie and header comparison. The default cookie is
`__Host-vf_csrf`; it is host-only, path-scoped to `/`, and always secure.
Cookie/header names and token lifetimes are bounded both in configuration and
at the public helper boundary. State-changing requests are checked unless an
exact, schema-validated exclusion applies.

### Authentication

`AuthHandler` accepts either one Basic credential pair or one bearer token.
Ambiguous environment configuration fails closed. Unauthorized responses are
non-cacheable and receive the resolved CORS and security policy. Credential
verification uses constant-time comparison.

### Response headers

`ResponseBuilder` centralizes CSP, HSTS, framing, cross-origin, referrer, cache,
and CORS response headers. Server integrations remove project-provided
policy-owned headers before applying the host policy. Project configuration can
override supported security headers, but `Access-Control-*` values must be
configured through CORS.

### Paths and filesystem access

Path validation canonicalizes existing ancestors, rejects traversal and
symlink escapes, and applies context-specific rules. `SecureFs` validates a
path before delegating to the configured runtime adapter.

This is a path-admission boundary, not an operating-system capability sandbox.
A hostile actor that can concurrently replace filesystem entries can still
create time-of-check/time-of-use races on adapters without descriptor-relative
filesystem operations. Production deployments must not grant project code
independent write access to the host paths being served.

## Internal worker isolation

[`sandbox/`](./sandbox/) is an internal runtime implementation used by Routing,
Data, and Rendering. It is not exported from `veryfront/security`.

The worker pool provides:

- bounded worker count and concurrent admissions;
- per-request deadlines and generation retirement;
- scoped read and environment permissions;
- prepared-module size and retained-module limits;
- a private control port protected from project-code message forgery;
- DNS-pinned outbound networking that blocks loopback, private, link-local,
  metadata, and other non-global destinations by default; and
- deterministic cleanup of workers, streams, timers, and egress brokers.

Worker isolation is disabled unless `WORKER_ISOLATION_ENABLED` and the relevant
`WORKER_ISOLATION_API`, `WORKER_ISOLATION_DATA`, or `WORKER_ISOLATION_SSR` flag
are enabled. Defined invalid flags and pool limits are startup errors; they are
not silently replaced with defaults.

Deno Workers share the host process. Worker retirement is lifecycle hygiene,
not a hard per-worker memory boundary. Strong memory and process containment
requires a separately limited process or container.

## Internal-only files

- [`client/`](./client/) validates trusted HTML and serializes values for inline
  scripts.
- [`http/`](./http/) contains handler, CORS, and response-policy
  implementations.
- [`input-validation/`](./input-validation/) contains bounded body readers and
  request parsers.
- [`path-validation/`](./path-validation/) contains canonicalization and
  validation rules.
- [`sandbox/`](./sandbox/) contains the project-worker protocol and pool.
- [`rate-limit/client-key.ts`](./rate-limit/client-key.ts) is the shared client
  identity helper used by public middleware rate limiting.

The remaining legacy files under `rate-limit/` are not package-exported and
have no production consumer. They must not be presented as the supported rate
limiter; the maintained implementation is in `src/middleware/builtin/security`.

## Verification

Run the complete module portfolio with:

```sh
DENO_TESTING=1 VF_DISABLE_LRU_INTERVAL=1 NODE_ENV=test \
  deno test --preload=src/schemas/_test-setup.ts --no-check --allow-all \
  --unstable-worker-options --unstable-net src/security
```

Use `--trace-leaks` for the closure gate. Worker, Routing, Data, Rendering, and
Server consumer suites are also required after changes to the sandbox protocol,
permissions, CORS, response headers, or request parsing.
