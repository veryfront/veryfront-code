# Security module reference

`src/security` owns Veryfront's request-security primitives, application
authentication, and the internal worker boundary used to run project code. Its
server-facing package entrypoint is `veryfront/security`, mapped to
[`index.ts`](./index.ts). Browser code imports the CSRF mutation helper from
`veryfront/index.client`.

This module does not provide password hashing, SQL escaping, direct LDAP
binding, or a public sandbox API. Application authentication supports the
runtime's Basic and bearer-token request gate, OIDC login, and self-hosted
trusted-proxy identity. Public rate limiting belongs to
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
context. Derivation enables the default CSRF policy when the project does not
specify one, in every environment, so local development and production resolve
the same value. A failed configuration load fails the current request and
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

CSRF uses a double-submit cookie and header comparison. HTTPS and loopback
origins use `__Host-vf_csrf`, which is host-only, path-scoped to `/`, and always
secure. Plain-HTTP LAN development uses an origin-scoped
`vf_csrf_http_<encoded-origin-and-config>` physical cookie, because browsers
discard `Secure` `__Host-` cookies there and an HTTP sibling must not collide
with an HTTPS token. Its companion `vf_csrf_names_<encoded-origin>` cookie lets
`csrfMutationHeaders` discover that physical name; application code should not
read or construct it directly. During migration, if an HTTP sibling still
advertises a legacy shared token, HTTPS uses an origin-scoped
`vf_csrf_https_<encoded-origin-and-config>` token instead of making that legacy
cookie unreadable to the already-open HTTP app. The default header is
`x-csrf-token`.
Cookie/header names and token lifetimes are
bounded both in configuration and at the public helper boundary.
State-changing requests are checked unless an exact, schema-validated exclusion
applies.

Use `csrfMutationHeaders` for a browser mutation that does not use a Veryfront
client hook. The helper adds the default CSRF header for same-origin requests
and preserves any headers you provide.

```ts
import { csrfMutationHeaders } from "veryfront/index.client";

const response = await fetch("/api/cases", {
  method: "POST",
  headers: csrfMutationHeaders("/api/cases", {
    headers: { "content-type": "application/json" },
  }),
  body: JSON.stringify({ title: "Example case" }),
});

if (!response.ok) {
  throw new Error(`Request failed with status ${response.status}`);
}
```

Custom names need no options either. When `security.csrf` sets `cookieName` or
`headerName`, the server publishes both in an origin-specific
`vf_csrf_names_<encoded-origin>` cookie and the helper discovers them, so the
call above is unchanged and the names stay defined in one place.

Pass them explicitly only to override that discovery:

```ts
const headers = csrfMutationHeaders("/api/cases", {
  headers: { "content-type": "application/json" },
  cookieName: "my_csrf",
  headerName: "x-my-csrf",
});
```

The advertisement carries no secret. The header name is visible on every request
the browser makes and the cookie name is visible in `document.cookie`, and the
server always validates against its own configuration, so a tampered value only
makes the browser send a header the server is not reading, which fails closed
with `403`.

`security.csrf` defaults to on, and `deriveSecurityContext` resolves that
default identically in every environment. Local development therefore issues
the same token cookie and runs the same validation as a deployed build, so a
mutation that omits the header fails on the developer's machine rather than on
the first deploy. `security.csrf: false` is the one opt-out; it suppresses both
the check and the cookie, everywhere.

A rejection answers with a body naming the cookie and header that project has
in effect and pointing at `csrfMutationHeaders` only when the project is an
explicitly local one _and_ the request satisfies `isTrustedLocalControlRequest`.
`ctx.isLocalProject` on its own is filesystem topology, not environment: a
deployed multi-project runtime that resolves a project directory on disk sets
it too, and would otherwise describe that project's policy and its opt-out to
anyone who could reach the origin. Requiring the loopback evidence as well
keeps the diagnostic on the developer's own machine, and every other caller
keeps the unchanged, opaque rejection.

Two framework-owned local development mutations are exempt: the client log
endpoint and the dashboard API. Neither is project code, neither holds the
token cookie, and both re-apply `isTrustedLocalControlRequest` themselves. That
gate rejects `sec-fetch-site: cross-site`, any proxy hop, and any host but a
canonical local-development one, so it is a stricter cross-site defence than
the double-submit pair rather than a hole beside it.

### Authentication

`AuthHandler` accepts one Basic credential pair, one bearer token, one OIDC
application login config, or one trusted-proxy config. Ambiguous environment
configuration fails closed. Unauthorized responses are non-cacheable and receive
the resolved CORS and security policy. Credential verification uses
constant-time comparison.

OIDC application auth runs before project middleware, uses authorization code
flow with PKCE, verifies ID tokens through bounded discovery and JWKS caches,
and stores transaction and session state in encrypted cookies. These cookies
make horizontally scaled runtimes correctness-independent as long as every
instance receives the same session secret. Trusted-proxy auth is self-hosted
only and trusts exact native peer provenance, not caller-controlled forwarding
headers.

### Local development control surfaces

The `/_dev` dashboard, development file bundling, debug context, process
metrics, memory controls, and client-log ingestion form privileged local-only
surfaces. A request is admitted only from a transport-authenticated loopback
peer with no forwarding headers and an untrusted proxy topology, addressed by
literal loopback or a canonical local-development hostname (see
[`http/local-control-request.ts`](./http/local-control-request.ts)). Dashboard
mutations additionally require a port-scoped double-submit session issued to
the trusted shell.

When Fetch Metadata is present, only `sec-fetch-site: none` (address bar or
bookmark navigation) and `same-origin` requests pass. A link from a rendered
project site such as `project.localhost:3000` to `localhost:3000/_dev` is same-site
but cross-origin and is rejected with `403` by design: sibling local origins
execute untrusted project code and must not be able to drive any privileged
local control. Open the dashboard directly instead; this is intended behavior,
not a lockout bug.

### Shared proxy identity and project environments

Production shared-proxy mode requires an operator-owned, private edge and
`VERYFRONT_TRUST_FORWARDED_HEADERS=1`. That edge must remove client-supplied
forwarding, project, environment, release, branch, path, and token headers
before setting the canonical values. The runtime origin must not be reachable
directly. Every tenant-bearing route, including module and WebSocket routes,
requires the edge-supplied project slug and request credential; a process-level
API token is never substituted for a missing shared-request credential.

Project and environment IDs become cache or secret-fetch authority only after
that same proxy trust check succeeds. The proxy forwards an environment ID only
with the canonical environment name selected from project metadata; the runtime
rejects partial pairs and ignores both headers outside the trusted topology.
Environment cache identity includes the canonical project slug, project ID,
environment ID, and a digest of the request credential. Fetch failure, timeout,
credential rejection, or explicit invalidation never returns stale or empty
secret data.

Hosted proxy mode requires both `VERYFRONT_API_INTERNAL_USER` and
`VERYFRONT_API_INTERNAL_PASS`, and `VERYFRONT_API_BASE_URL` must provide the
canonical `/internal/project-environment-variables` endpoint. Before using
those host credentials, the runtime verifies the request bearer token against
the project-scoped management endpoint. A missing credential, redirected
endpoint, or failed internal request is an error. There is no compatibility
fallback to masked management values. Local CLI proxy mode and non-proxy
runtimes do not require these host credentials.

#### Trust boundary and residual risk

With `VERYFRONT_TRUST_FORWARDED_HEADERS=1` set, identity headers are trusted
purely on network topology: any peer that can reach the runtime origin can
assert project, environment, and branch identity on routes outside the signed
control-plane path. There is no per-request cryptographic binding on the
proxy-to-runtime hop, so the design has no defence in depth if pod network
privacy fails. Operators must keep the runtime origin unreachable except from
the proxy (private service plus network policy). Planned follow-up: an
authenticated proxy-to-runtime hop (mTLS or a per-hop shared secret) so
identity headers are honoured only on an authenticated channel. Agent-run
dispatch is already independent of this hop; its branch and environment
binding comes from the signed control-plane request body.

#### Rollout ordering for hosted identity changes

The hosted runtime fails closed at boot without
`VERYFRONT_TRUST_FORWARDED_HEADERS=1`,
`VERYFRONT_API_INTERNAL_USER`, and `VERYFRONT_API_INTERNAL_PASS`. Hosted agent
runs also fail closed without the branch identity that only the current proxy
derives from the signed control-plane body. Upgrading an existing deployment
is safe in this order:

1. Deploy and verify the canonical
   `/internal/project-environment-variables` endpoint on
   `VERYFRONT_API_BASE_URL`. Provision the credential pair that the endpoint
   accepts.
2. Set `VERYFRONT_API_INTERNAL_USER`, `VERYFRONT_API_INTERNAL_PASS`, and
   `VERYFRONT_TRUST_FORWARDED_HEADERS=1` (and ensure
   `CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY` is set) on the runtime environment
   while it still runs the previous version. Earlier runtimes already accept
   the trust variable and internal credentials. Step 1 ensures that their
   privileged environment reads succeed before the new boot requirement takes
   effect.
3. Deploy the proxy tier. Earlier runtimes ignore the added
   `x-default-branch-name` header, and the `vf-utf8:` branch-name encoding is
   applied only to values an earlier proxy could not forward at all.
4. Deploy the runtime tier. A new runtime booted without steps 1 and 2
   crash-loops intentionally. A new runtime behind an old proxy rejects hosted
   preview-branch and non-default-branch agent runs with `PERMISSION_DENIED`
   because branch identity must come from the verified control-plane binding.

Roll back the runtime first, then the proxy. Keep the internal endpoint,
credentials, and trust variable in place throughout rollback. After the older
runtime is active, operators can unset the internal credentials before removing
the internal endpoint. There is deliberately no warn-only compatibility mode
for a missing trust declaration, missing hosted credential, or missing branch
binding. Any of these gaps can expose or select incorrect tenant data.

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

The response nonce is applied to framework-generated inline tags, validated
structured `Head` script/style declarations, and explicitly source-authored
static HTML documents. Veryfront does not add the nonce to raw SSR output,
because doing so would authorize arbitrary application or user-controlled
markup under CSP. Use structured `Head` declarations, external same-origin
assets, or explicit CSP hashes for application-owned inline code. Structured
`Head` authorization is registered in request-scoped render state; serialized
DOM attributes alone never establish trusted provenance.

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

Framework-owned fetches of tenant-selected remote modules, OpenAPI and remote
MCP endpoints, OAuth provider endpoints, and project-configured model and
embedding provider base URLs pass through a DNS-pinned HTTP boundary. It admits only public
`http:` and `https:` destinations, rejects URL credentials, blocks loopback,
private, link-local, metadata, and other non-global addresses, and repeats both
the network and caller-specific allowlist checks before every redirect hop.
Cross-origin redirects do not retain authorization or cookie headers.

`VERYFRONT_HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS` is the narrow exception for
model and embedding providers on internal networks. Its value is a
comma-separated list of exact HTTP origins, including scheme, host, and port
without a path. The exception applies only to an origin-bound provider
transport configured for the same origin. Redirects remain rejected, and all
other internal destinations remain blocked. Project environment overlays
cannot add origins to this host-owned list.

`VERYFRONT_HOST_ALLOW_INTERNAL_EGRESS=1` is an operator-owned compatibility
override. It disables the private-network destination check for these host
fetches and must remain unset in a shared runtime. Project environment overlays
cannot enable it. URL scheme, URL-credential, redirect, and caller allowlist
checks remain active when the override is enabled.

Cloud credentials are bound to their endpoint provenance: a request-scoped
Cloud base URL must carry a request-scoped token, and gateway fetches admit only
their configured origin with redirects rejected. A caller-selected endpoint
cannot inherit a host or request credential.

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
shared-runtime boundary.

`WORKER_ISOLATION_ENABLED` is a gate, not a surface. All three surface flags
require it, and on its own it enables none of them.

A configuration can therefore read as enabled and still resolve to no active
isolation surface, which looks safe to anyone auditing the environment. Flag
resolution reports itself once to close that gap. It logs the effective
per-surface state at `info`. It logs a `warn` when the master switch is set with
no surface in force, and when surface flags are set without the master switch.

`security/sandbox/worker-pool.ts` exposes the same resolution as a typed
`getIsolationPosture()` snapshot: requested versus effective per surface, plus
`apiPreparationSupported`. The production server resolves the posture at
startup, so it lands in the startup log rather than on the first request.

The posture is not published on the unauthenticated `/_health` response, where
it would tell an anonymous caller which realm tenant code runs in.

A dedicated single-project runtime may execute
prepared API source in its local worker pool. A shared multi-project/proxy
runtime never executes tenant API source in the host process or a same-process
Worker: API ownership returns the typed
`project-execution-unavailable` 503 response until the request is routed to a
genuinely external or dedicated isolated project runtime. Raw-path server-data
modules are local-only; remote data and renderer-backed module endpoints return
503 before resolving project modules. Shared-runtime CORS preflights never
import route modules to discover methods, and component-snippet requests fail
before source reads or compilation. Shared markdown previews likewise stop
before source reads or custom not-found rendering.
Defined invalid flags and pool limits are startup errors; they are not silently
replaced with defaults.

`WORKER_ISOLATION_API` is consulted only by API route execution
(`routing/api/handler.ts` and `routing/api/route-executor.ts`), which resolve it
through the single `isHostRealmApiExecution` accessor. Data fetchers and SSR
have their own flags. Agent streams are gated by `allowHostProjectCodeExecution`
alone.

A runtime that cannot honour a configured isolation flag never fakes it. A
compiled binary cannot prepare isolated API route source
(`security/sandbox/isolation-capability.ts`), so `WORKER_ISOLATION_API=1` in a
compiled deployment keeps the requested isolation posture and API ownership
returns the typed `project-execution-unavailable` 503 naming it. The broad
`VERYFRONT_HOST_ALLOW_PROJECT_EXECUTION` grant does not override the
API-specific isolation flag.

OpenAPI metadata is currently attached to handler functions. Because reading
it requires route evaluation, runtime OpenAPI generation is available only for
explicitly trusted local projects; remote requests fail closed before route
discovery or import.

Executable primitive discovery, API ownership, app-router execution, and root
project middleware use the same explicit host-execution capability, expressed
as the single `requiresIsolatedProjectRuntime` predicate. Local development and
dedicated single-project runtimes grant the capability at their host-owned
entrypoints. Shared proxy runtimes reject these operations before reading or
evaluating tenant modules.

## Operator-granted shared execution

`VERYFRONT_HOST_ALLOW_PROJECT_EXECUTION=1` grants the host-execution capability
to a shared runtime whose deployment intends that runtime to _be_ the project
executor. Absent and unrecognized values fail closed, matching
`VERYFRONT_HOST_ALLOW_INTERNAL_EGRESS`.

The override is read exactly once, at server startup in
`server/production-server.ts`, and the resulting capability is fixed into the
handler for the process lifetime. It is read through `getHostEnv`, which
bypasses the project env overlay, so a project environment variable of the
same name cannot grant execution. Reading once at startup keeps a deployment's
posture fixed and declared in a single place.

This is a deliberate posture, not a bypass. With the override set, tenant
project code is evaluated in the shared host process. Per-request separation is
the `runWithContext` source scope and the project-scoped registry transaction,
not a process, memory, or CPU boundary between tenants. Deno Workers do not
change that; they share the host process.

Operators who need a genuine tenant boundary must leave the override unset and
route execution to an external or dedicated isolated project runtime. Unsetting
it re-arms every surface above with no code change.

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
