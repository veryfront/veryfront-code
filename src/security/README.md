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

| Area             | Runtime exports                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| HTTP handlers    | `BaseHandler`, `AuthHandler`, `CsrfHandler`, `SecurityConfigLoader`, deprecated `loadSecurityConfig` and `isValidSecurityConfig`                 |
| Input boundaries | `validateRequestLimits`, `readBodyWithLimit`, `parseJsonBody`, `parseFormData`, `parseQueryParams`, `createValidatedHandler`                     |
| CORS             | `cors`, `corsSimple`, `validateOrigin`, `validateOriginSync`, `applyCORSHeaders`, `applyCORSHeadersSync`, `handleCORSPreflight`                  |
| CSRF             | `generateCsrfToken`, `validateCsrf`, `applyCsrfCookie`                                                                                           |
| Responses        | `ResponseBuilder`, `createResponseBuilder`, `applySecurityHeaders`, `buildCacheControl`, `generateNonce`                                         |
| Paths and files  | `validatePath`, `validateLexicalPath`, deprecated `validatePathSync`, `createValidator`, `createSecureFs`, `SecureFs`, `wrapAdapterWithSecurity` |
| Deno permissions | `BUILD_HELPER_PERMISSIONS`, `SERVER_PERMISSIONS`, `WORKFLOW_RUN_PERMISSIONS`                                                                     |

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

`SecurityConfigLoader` is the canonical runtime configuration loader. Call
`ensureLoaded()` before reading its derived values. The deprecated
`loadSecurityConfig()` and `isValidSecurityConfig()` exports remain for source
compatibility. They delegate to the canonical loader/schema behavior;
`loadSecurityConfig()` propagates load and validation failures and returns
`null` only when no security policy is configured.

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

### Input validation

Each standalone body, form, and query parser applies the same snapshotted
request limits as `createValidatedHandler`. Query parsing measures the complete
URL in UTF-8 bytes before allocating parameter collections. JSON parsing also
captures the decoded value through the framework's bounded, iterative JSON
snapshot before invoking a schema, so excessive depth, node count, or string
size cannot be delegated to a recursive validator. Composite handlers reuse
their already-validated request boundary rather than silently skipping or
repeating those checks.

### Response headers

`ResponseBuilder` centralizes CSP, HSTS, framing, cross-origin, referrer, cache,
and CORS response headers. Server integrations remove project-provided
policy-owned headers before applying the host policy. Project configuration can
override supported security headers, but `Access-Control-*` values must be
configured through CORS. The production default CSP admits only same-origin
resources plus narrowly required nonce, data, and blob sources; CDN, font,
media-provider, analytics, and API origins must be declared by the owning
extension or explicit project CSP. The obsolete browser XSS auditor is disabled
with `X-XSS-Protection: 0`.

### Paths and filesystem access

Path validation canonicalizes existing ancestors, rejects traversal and
symlink escapes, and applies context-specific rules. `SecureFs` validates a
path before delegating to the configured runtime adapter. Its trust root and
policy are immutable after construction; it exposes no raw-adapter escape
hatch. Policy records and directory allowlists are copied from own data
properties, so inherited settings, accessors, and later caller mutations cannot
change the active policy. Directory iteration and watcher installation use
asynchronous physical canonicalization. Filesystem adapters must provide
`lstat`/`realPath` for the requested symlink policy or explicitly guarantee that
their API cannot traverse symbolic links; unknown semantics fail closed.
An omitted module-import allowlist is explicitly unrestricted within the
project root, while an empty allowlist denies every project subdirectory; the
two states are never collapsed.
Callers that create a watcher must await `watcher.ready` before assuming it is
active. Binary reads require a native binary-safe adapter capability and never
fall back to text transcoding. Temporary directories are created beneath the
configured trust root.

`validateLexicalPath` performs only string-level containment checks. It does
not accept adapter, existence, or symlink-policy options and must not be used as
filesystem admission for a local or otherwise symlink-capable backing store.
The deprecated `validatePathSync` compatibility wrapper applies the same
lexical-only behavior while accepting historical policy fields; those fields
cannot enable filesystem checks or weaken containment.
Conversely, `validatePath` always requires the runtime adapter whose filesystem
will perform the admitted operation. `ValidationPresets` are immutable policy
fragments, not standalone physical validators; combine a preset with that
adapter or use `SecureFs`, which does so at construction.

This is a path-admission boundary, not an operating-system capability sandbox.
A hostile actor that can concurrently replace filesystem entries can still
create time-of-check/time-of-use races on adapters without descriptor-relative
filesystem operations. Production deployments must not grant project code
independent write access to the host paths being served.

## Host outbound HTTP policy

Framework-owned fetches of tenant-selected remote modules and remote MCP
endpoints pass through a DNS-pinned HTTP boundary. It admits only public
`http:` and `https:` destinations, rejects URL credentials, blocks loopback,
private, link-local, metadata, and other non-global addresses, and repeats both
the network and caller-specific allowlist checks before every redirect hop.
Cross-origin redirects do not retain authorization or cookie headers.

`VERYFRONT_HOST_ALLOW_INTERNAL_EGRESS=1` is an operator-owned compatibility
override. It disables the private-network destination check for these host
fetches and must remain unset in a shared runtime. Project environment overlays
cannot enable it. URL scheme, URL-credential, redirect, and caller allowlist
checks remain active when the override is enabled.

## Internal worker isolation

[`sandbox/`](./sandbox/) is an internal runtime implementation used by Routing,
Data, and Rendering. It is not exported from `veryfront/security`.

The worker pool provides:

- bounded worker count and exactly one active admission per serialized worker;
- per-request deadlines and generation retirement;
- project-root reads plus immutable framework-source reads in compiled builds,
  with shared caches and `DENO_DIR` excluded;
- denied Deno environment permission, with a frozen request-owned `env` record
  passed through App and Pages handler contexts instead;
- denied remote module imports, including for renderer dependencies;
- prepared-module size and retained-module limits;
- bounded, normalized data-loader results before worker-to-host transfer;
- a private control port protected from project-code message forgery;
- DNS-pinned outbound networking that blocks loopback, private, link-local,
  metadata, and other non-global destinations by default; and
- deterministic cleanup of workers, streams, timers, and egress brokers.

The `WORKER_ISOLATION_ENABLED` and surface-specific
`WORKER_ISOLATION_API`, `WORKER_ISOLATION_DATA`, and `WORKER_ISOLATION_SSR`
flags opt trusted local projects into worker execution. They cannot disable the
shared-runtime boundary. A dedicated single-project runtime may execute
prepared API source in its local worker pool. A shared multi-project/proxy
runtime never executes tenant API source in the host process or a same-process
Worker: API ownership returns the typed
`project-execution-unavailable` 503 response until the request is routed to a
genuinely external or dedicated isolated project runtime. Raw-path server-data
modules are local-only; remote data and renderer-backed module endpoints return
503 before resolving project modules.
Defined invalid flags and pool limits are startup errors; they are not silently
replaced with defaults.

OpenAPI metadata is currently attached to handler functions. Because reading
it requires route evaluation, runtime OpenAPI generation is available only for
explicitly trusted local projects; remote requests fail closed before route
discovery or import.

Executable primitive discovery and root project middleware use the same
explicit host-execution capability. Local development and dedicated
single-project runtimes grant it at their host-owned entrypoints. Shared proxy
runtimes reject these operations before reading or evaluating tenant modules;
they must provide an isolated project runtime before enabling either surface.

`WORKER_ISOLATION_SSR=1` additionally requires explicit registration of an
`IsolatedSsrRendererProvider`. The provider supplies a local, offline renderer
bundle through the isolated-SSR contract. Core does not import React, and there
is no host-rendering or remote-import fallback. The current HTTP renderer does
not yet produce a generation-owned isolated page and layout graph, so remote
SSR and server-executing RSC endpoints return `503 Service Unavailable` before
resolving a renderer. API and data workers do not resolve or receive the
renderer contract.

Deno Workers share the host process. Worker retirement is lifecycle hygiene,
not a hard per-worker memory or CPU boundary. They are therefore limited to
local development and dedicated single-project execution, where one project
cannot deny service to unrelated tenants. Shared multi-project execution must
use a separately limited external process or container; there is no operator
flag that reclassifies same-process Workers as a safe tenant boundary.

Before application-controlled API handlers, project middleware, SSR/data
rendering, or RSC action authorization receives a request, the runtime creates
a detached application request. Public application credentials such as
`Authorization` and `Cookie` are retained. Infrastructure-only credentials,
project/source identity, trusted-proxy metadata, and `x-veryfront-*` control
headers are withheld. The original request remains available only to the
host-owned admission and routing pipeline.

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

The maintained rate limiter is in `src/middleware/builtin/security`; Security
contains no second implementation.

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
