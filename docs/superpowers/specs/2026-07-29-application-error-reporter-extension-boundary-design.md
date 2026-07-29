# Application Error Reporter Extension Boundary Design

**Date:** 2026-07-29\
**Status:** Approved with the dependency-free-core invariant\
**Scope:** Core application-error reporting, the Node agent-service bridge, the Sentry extension, and emitted package artifacts

## Context

Veryfront core already has a vendor-neutral `ApplicationErrorReporter` shape and a sanitizing application-error facade. Recent Sentry work bypasses that architectural boundary in several ways:

- `src/agent/service/node-sentry.ts` probes workspace `.ts` and `.js` files before trying a package import.
- `src/agent/service/node-runtime-infrastructure.ts` converts any configured Sentry initialization failure into an enabled-false no-op lifecycle whose flush reports success.
- The root npm build follows the workspace import and emits Sentry extension implementation files inside the root package, even though the root package deliberately does not own `@sentry/node`.
- The Node and Deno extension factories expose SDK injection parameters derived from vendor types, so their public declarations import `@sentry/*`.
- The Node agent-service reporter is reset in `runAgentServiceMain().finally()` after listener readiness, rather than remaining active for the runtime's actual lifetime.
- The existing `veryfront/observability/sentry` core entrypoint owns Sentry-specific environment parsing and uses the generic source-then-package extension import helper.

These behaviors violate the project invariant that production core and root artifacts may depend only on first-party contracts, first-party extension boundaries, and runtime built-ins. Third-party implementation code, configuration, types, declarations, and lifecycle ownership must remain inside the providing extension. Runtime probing, compatibility fallbacks, and silent degradation are not accepted.

## Repository-wide dependency invariant

This design applies one slice of a repository-wide rule:

- production core includes `src/`, `cli/`, root package manifests, and generated or shipped npm, browser, and binary artifacts;
- production core may import only first-party core/contracts/extensions and runtime built-ins;
- external packages, including implementation libraries and their public types, are owned and imported only by separately packaged extensions;
- tests and build tooling may use development dependencies, but must not cause those dependencies to enter production source, declarations, manifests, bundles, or binary dependency graphs;
- a boundary check must inspect source, public declarations, package metadata, and generated artifacts rather than treating a clean source scan as sufficient.

For manifests, production ownership means runtime import-map entries, exports, dependencies, peer dependencies, optional dependencies, bundled dependencies, compile inputs, and package files. Workspace membership, development-only mappings used exclusively by isolated tooling, and a shared lockfile may record extension dependencies without making them core dependencies; artifact and graph checks must prove that those dependencies are unreachable from core production roots.

`jsr:@std/*` is an external package, not a runtime built-in, and is therefore forbidden in production core under this rule. It remains permitted in isolated tests and build tooling.

The Sentry extraction is the immediate scope of this design. Other existing vendor edges remain required work in the module-hardening program; narrowing this implementation slice does not waive the repository-wide invariant.

## Goals

1. Make application-error reporting a named, vendor-neutral first-party extension contract.
2. Remove Sentry imports, Sentry configuration, and extension discovery from core and CLI runtime code.
3. Require explicit extension composition when application-error reporting is enabled.
4. Fail startup when reporting is explicitly enabled but its provider is absent, invalid, or fails initialization.
5. Keep capture failure from replacing the application failure being reported.
6. Keep flush and teardown bounded, observable, and truthful.
7. Keep the reporter active until the owning runtime actually stops.
8. Ensure root npm/browser/binary artifacts do not acquire direct vendor imports, declarations, or undeclared transitive ownership.
9. Keep Node and Deno SDK implementations and installation closures isolated in separate runtime-specific Sentry extension packages.

## Non-goals

- This change does not redesign tracing, metrics, or OpenTelemetry ownership.
- It does not retain a Sentry-specific convenience API in core through a deprecated wrapper.
- It does not add a second fallback reporter when the selected provider fails.
- It does not solve every pre-existing first-party source/package probe in the repository; those remain part of the broader dependency-extraction program.
- It does not claim that capture delivery can be made infallible. It makes delivery failure bounded and diagnosable without replacing the original application error.

## Approaches considered

### 1. Named `ApplicationErrorReporter` extension contract — selected

Core consumes one generic contract. Runtime-specific Sentry extensions provide it through the existing extension loader. The runtime composition root selects the extension; core never imports or discovers it.

This gives the extension loader ownership of setup, rollback, authority revocation, and reverse-order teardown. It also makes the dependency boundary directly testable in source and emitted artifacts.

### 2. Reporter-factory injection only

Core could accept a reporter factory from every host. This provides strong dependency inversion, but duplicates lifecycle composition across CLI, server, proxy, and agent-service hosts and bypasses the loader's existing rollback and teardown guarantees.

### 3. Exact optional Sentry package import from core

Core could replace probing with one `@veryfront/ext-observability-sentry/*` import and teach dnt to externalize it. This is smaller and preserves automatic activation, but core remains vendor-aware and compiled artifacts still need special-case build mapping. It does not satisfy the stronger dependency-free-core invariant.

## Decision

This section through Acceptance criteria is the normative boundary specification. Context and Approaches considered explain the rationale but do not weaken these requirements.

### Contract

Add a first-party contract module under `src/extensions/observability/`:

```ts
export const ApplicationErrorReporterName = "ApplicationErrorReporter";

export type ApplicationErrorContext = {
  boundary: string;
  method?: string;
  requestId?: string;
  spanId?: string;
  traceId?: string;
  attributes?: Record<string, string | number | boolean>;
};

export interface ApplicationErrorReporter {
  capture(error: unknown, context: ApplicationErrorContext): string | undefined;
  flush(timeoutMs: number): Promise<boolean>;
}
```

The existing application-error facade remains the single place that snapshots, bounds, and sanitizes context before delegation. The contract module re-exports or owns these types without creating duplicate definitions.

The public facade may offer a default, but every provider call receives an explicit integer deadline. The default is 2,000 ms and the accepted range is 1–30,000 ms; invalid values fail validation before provider invocation. Provider teardown uses an explicit deadline from the same range and rejects if flush is incomplete.

Core contract resolution uses `ApplicationErrorReporterName`; it has no Sentry-specific contract name.

### Provider extensions

`@veryfront/ext-observability-sentry-node` and `@veryfront/ext-observability-sentry-deno` become separate extension packages and real extension factories. Each package:

- statically imports exactly its own SDK;
- declares `contracts.provides: [ApplicationErrorReporterName]`;
- validates its provider-specific configuration before side effects;
- initializes the SDK during `setup()`;
- publishes a structurally validated `ApplicationErrorReporter` through `ctx.provide()`;
- performs bounded flush and provider shutdown during `teardown()`;
- rejects setup or teardown when the provider cannot honor the lifecycle contract.

SDK injection remains an internal extension test seam. Public reporter and extension-factory signatures contain only first-party contract and configuration types. Generated public declarations must not import `@sentry/node` or `@sentry/deno`.

Splitting the packages is intentional: npm dependencies are package-scoped, not export-subpath-scoped. Installing the Node provider must not install the Deno SDK, and installing the Deno provider must not install the Node SDK.

### Composition and activation

The application composition root selects exactly one runtime-specific provider extension and passes the resulting first-party `ExtensionFactory` through the generic host configuration boundary. Provider selection and provider-specific environment parsing are extension/application responsibilities: `src/`, `cli/`, and root build metadata do not map `sentry` to a package, import a Sentry composition helper, or read `SENTRY_*` variables. A generic host may activate factories already present in project configuration, but it cannot discover a provider by probing source and package locations.

The official CLI obtains extensions only from the generic `extensions` list in the loaded project configuration. Application code explicitly imports the appropriate Sentry extension package and adds its factory to that list. Programmatic agent and server hosts receive the same generic list through their host options. Unknown generic activation values, duplicate `ApplicationErrorReporter` providers, and more than one configured reporter are startup errors.

Core treats application-error activation generically:

- no configured reporter means explicitly disabled and returns a disabled lifecycle;
- configured reporting requires `resolve(ApplicationErrorReporterName)` after extension activation;
- a missing provider raises the existing missing-extension error;
- an invalid provider or provider setup failure aborts startup;
- core does not catch these failures and replace them with a no-op reporter.

`VERYFRONT_ERROR_REPORTER` may remain only as a generic boolean enabled/disabled signal; values naming a vendor are removed. It cannot be a core-owned registry of vendor names. Provider-specific environment variables such as `SENTRY_DSN` are read and validated inside the selected extension or application composition module. Node agent-service activation becomes consistent with the generic contract instead of enabling implicitly from a DSN alone.

The public `veryfront/observability/sentry` core entrypoint is removed. Sentry-specific creation and configuration APIs live in `@veryfront/ext-observability-sentry-node` and `@veryfront/ext-observability-sentry-deno`. This is an intentional breaking change required by the dependency boundary.

### Core facade and consumers

`captureApplicationError()` remains non-throwing. A reporter exception cannot replace the request, startup, or shutdown failure that triggered reporting. The facade records a bounded, rate-limited, non-recursive lifecycle diagnostic when capture fails; it must not report that diagnostic through the failing reporter.

`flushApplicationErrors()` returns `true` only when the active reporter confirms completion. Invalid deadlines, timeout, rejection, or provider `false` return `false`. Startup and shutdown owners must treat `false` as incomplete diagnostics rather than successful flush.

The Node agent log bridge becomes provider-neutral. It may translate unexpected agent log records into `ApplicationErrorContext`, but it does not resolve, import, configure, or name Sentry.

### Lifetime and teardown

Application-error lifecycle ownership follows the runtime handle, not the bootstrap promise:

- setup completes before telemetry and request acceptance;
- the reporter remains installed after listener readiness;
- a startup failure captures once, attempts bounded flush, and tears down only if provider initialization completed; a provider cannot report its own initialization failure through itself;
- normal shutdown first quiesces log/request consumers, then flushes and tears down the provider;
- stale lifecycle owners cannot clear a newer provider generation;
- a failed provider teardown remains visible and retryable through the extension loader's existing failed-generation handling.

`startAgentService()` must not reset reporting merely because `startAgentServiceRuntime()` returned a ready server. Cleanup is attached to the returned runtime stop lifecycle or the process shutdown owner.

### Artifact and dependency boundary

The root npm package and its declarations must contain:

- no `@sentry/node` or `@sentry/deno` import;
- no emitted `extensions/ext-observability-sentry/**` implementation tree;
- no Sentry SDK dependency in root `package.json`;
- no source path or package-probing loader for the Sentry extension.

Each separately emitted Sentry extension package must contain:

- exactly one manifest-owned runtime SDK dependency;
- `veryfront` as the first-party peer contract source;
- runtime-specific JavaScript importing only its corresponding SDK;
- public declarations that mention only first-party types;
- no relative references back into root source output.

The official core CLI binary contains no Sentry extension implementation, SDK, or transitive SDK closure in its module graph, explicit include inventory, virtual filesystem, source maps, or SBOM. A project-specific or separately named distribution artifact may explicitly compose the extension, but it is not a core artifact and has its own manifest and SBOM identifying the extension as the owner of the SDK closure.

## Error semantics

| Condition                                  | Required result                                                                  |
| ------------------------------------------ | -------------------------------------------------------------------------------- |
| Reporting not configured                   | Disabled lifecycle; provider is not resolved or initialized                      |
| Reporting configured, provider missing     | Startup fails with the missing-extension error                                   |
| Reporter selector unknown or duplicated    | Startup fails before request acceptance                                          |
| Provider config invalid                    | Extension setup rejects before publishing the contract                           |
| SDK initialization fails                   | Startup fails; no disabled fallback is installed                                 |
| Capture throws                             | Original application path continues; bounded non-recursive diagnostic is emitted |
| Flush rejects, times out, or returns false | Lifecycle reports incomplete diagnostics                                         |
| Teardown fails                             | Extension loader retains failed ownership for explicit retry                     |
| Concurrent replacement becomes stale       | Stale owner cannot publish or clear the current reporter                         |

## Verification strategy

Behavior changes follow red-green-refactor. Required regression coverage includes:

1. Configured provider load/setup failure propagates through CLI, server, proxy, and agent startup.
2. Disabled reporting performs no provider resolution or initialization.
3. The generic contract rejects missing and structurally invalid providers.
4. Capture sanitization, expected-error filtering, duplicate suppression, and non-recursive diagnostics remain bounded.
5. Flush false/timeout/rejection is never reported as success.
6. Reporter ownership survives listener readiness and ends only on actual runtime shutdown.
7. Startup failure is captured once and does not duplicate through the logger bridge.
8. Reverse teardown stops consumers before provider flush/shutdown.
9. Node and Deno extension public declarations expose only first-party contract and extension configuration types; vendor SDK types remain private implementation details.
10. Extension manifest `contracts.provides` metadata matches the factory's `ApplicationErrorReporterName` contract.
11. Root generated npm JavaScript, declarations, declaration maps, and source maps contain neither Sentry SDK edges nor embedded Sentry extension source.
12. Root production manifest fields and generated npm metadata contain no Sentry extension or SDK ownership; the shared lockfile is checked by reachability rather than string absence.
13. The packed root npm tarball, browser prebundles, compiled binary graph/includes/VFS, core/CLI SBOMs, and dependency snapshots contain no Sentry implementation closure.
14. Each runtime extension tarball declares exactly its own SDK, installs in a strict non-hoisted layout, and has no relative reference into root build output.
15. Strict consumer typecheck imports each runtime extension package without directly importing or mapping a Sentry SDK.
16. `veryfront/observability/sentry` is absent from root Deno/npm exports, declarations, and consumer mappings, and importing the removed subpath fails.
17. The dependency audit regression matrix covers relative and alias edges into `extensions/**`, `@veryfront/ext-*`, npm, bare npm, JSR, HTTP(S), type imports, dynamic imports, import-type expressions, triple-slash types, generated declarations/maps, all production dependency fields, and browser/binary resolved graphs.
18. A real filesystem fixture proves dependency-source discovery visits files and fails closed on a zero-file scan.
19. Sentry HTTP API references in templates remain allowed when they create no module, declaration, or dependency edge.

The implementation gate includes focused unit and lifecycle tests, extension tests under their isolated configurations, formatting and lint, generated artifact checks, `deno task verify:quick`, `deno task test:scripts`, a clean npm build, strict consumer typecheck, and the dependency-boundary audit.

## Documentation and migration

- Replace core Sentry setup examples with explicit runtime-specific extension composition.
- Document the generic application-error contract in the extension reference.
- Update agent-service and production-server guides to show provider activation and fail-closed startup semantics.
- Update each runtime-specific Sentry extension README with explicit project-configuration composition and lifecycle ownership.
- Regenerate API reference after removing the core Sentry entrypoint and adding the generic contract.
- Include the breaking change in release notes: `SENTRY_DSN` alone no longer activates Node agent reporting, vendor-valued `VERYFRONT_ERROR_REPORTER` selection is removed, and `veryfront/observability/sentry` is replaced by the selected runtime extension package.

## Acceptance criteria

The boundary is complete only when all of the following are proven from current artifacts:

- core contains no Sentry SDK or Sentry extension import/probing edge;
- explicitly enabled reporting cannot silently become disabled;
- the reporter remains active for the owning runtime's full lifetime;
- root emitted artifacts contain no Sentry implementation or vendor declaration edge;
- the official core binary contains no Sentry extension or SDK payload;
- runtime-specific extension artifacts each own and declare only their corresponding SDK dependency;
- public extension declarations are vendor-SDK-type-free and import only first-party contract/configuration types;
- the dependency-boundary audit itself has regression coverage proving that forbidden production imports and artifact edges cannot be silently skipped;
- relevant source, package, lifecycle, consumer, and artifact gates pass.
