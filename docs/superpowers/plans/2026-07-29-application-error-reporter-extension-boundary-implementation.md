# Application Error Reporter Extension Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every core-owned Sentry path with one fail-closed, vendor-neutral `ApplicationErrorReporter` extension boundary, isolate the Node and Deno SDKs in separate extension packages, prove that no reporter implementation reaches core, and produce the exact evidence backlog required to remove every other third-party core dependency.

**Architecture:** Application code explicitly constructs configured extensions. Core hosts accept only generic extension lists and generic enablement, then resolve the named first-party reporter contract after extension setup. The application-error facade delegates through the extension loader's generation-owned contract registry, while each Sentry extension owns SDK initialization, policy, bounded flush, close, and retryable teardown. Source, package, graph, binary, and SBOM gates inspect actual reachable artifacts rather than package names or lockfile strings.

**Tech Stack:** Deno 2.7.7, TypeScript, Veryfront extension loader, dnt/npm, Node.js

## Global Constraints

- Production core is `src/`, `cli/`, root production manifest fields, and generated or shipped root npm/browser/binary artifacts.
- Production core may import only first-party core/contracts/extension interfaces and runtime built-ins. `jsr:*`, `npm:*`, HTTP(S), bare vendor packages, vendor declarations, and extension implementation packages are not core dependencies.
- Tests and build/audit tooling may use pinned development dependencies, but those tools and their dependency closures must remain outside every shipped core source, npm, browser, and binary artifact.
- No code under `src/` or `cli/` may import Sentry, read `SENTRY_*`, translate a provider name to a package, probe source/package candidates, or silently install a no-op reporter.
- A separately packaged extension may own third-party runtime code. The root package, browser artifacts, and core CLI binary may not embed that implementation or its transitive closure.
- `@veryfront/ext-observability-sentry-node` and `@veryfront/ext-observability-sentry-deno` remain separate installation closures. Neither package may depend on or emit a reference to the sibling SDK.
- Reporting is explicit. Merely installing a package cannot activate it. Enabled reporting with no valid configured provider is a startup error.
- The reporter contract is reserved to the current config-only loader owner/generation. Public/manual registry APIs, primed contracts, built-ins, raw loaders, lifecycle callbacks, and legacy discovery cannot publish, replace, or clear it.
- Capture never replaces the application failure. Flush and teardown have explicit integer deadlines in the inclusive range 1–30,000 ms, defaulting to 2,000 ms.
- Provider initialization failure is propagated. There is no fallback reporter and a provider cannot report its own failed initialization through itself.
- Runtime consumers stop before provider teardown. Cleanup failures are captured while the reporter is still live. A failed teardown retains ownership and is retryable.
- Exactly-once delivery is owned by the innermost lifecycle boundary that first observes an error; outer wrappers log and aggregate but do not recapture it. Object-identity suppression is defensive only and is not used as the correctness mechanism for wrapped `AggregateError` or cleanup errors.
- The shared `deno.lock` may contain extension dependencies. Ownership is proved through resolved reachability from each production root, not through global string absence.
- The Sentry migration is one slice of the repository-wide dependency-free-core program. Generic gates must expose other existing third-party core edges; they must not add an allowlist or claim the whole repository is clean after only this slice.
- Complete every behavior change red-green-refactor. After each stable task, run `git diff --check`, make a focused commit, and push `codex/module-reconcile-20260723`.
- Every newly created `scripts/**/*.test.ts` file is added to the explicit `deno task test:scripts` command in the same checkpoint. A source-contract regression rejects an unregistered script test so CI cannot silently omit it.
- Keep the work-in-progress branch merge- and release-ineligible until the strict generic source and artifact gates reach zero. Before that point, the strict commands are explicit expected-red evidence commands and are not substituted for the existing aggregate gate; this preserves green recovery checkpoints without hiding the debt. No baseline, suppression, or exception file may make an expected-red command pass.
- Tasks 1–8 deliver independently recoverable reporter prerequisites. Task 9 performs one atomic source-plus-artifact cutover: its Phase A is never committed or pushed separately, and its Phase B verifies and commits the exact union. Task 10 builds fresh generic source/npm/browser/binary evidence and freezes an owner-specific extraction backlog; Task 11 documents this breaking reporter change and regenerates that evidence after its final package/config inputs change. If the final inventory reports any non-Sentry edge, this plan ends at that explicit phase boundary and separate exact extraction plans must remove every edge before gate promotion, release-artifact work, or final module verification.

---

## Task 1: Build fail-closed dependency evidence and repair extension checks

**Files:**

- Create: `scripts/lint/audit-core-deps-strict.ts`
- Create: `scripts/lint/audit-core-deps-strict.test.ts`
- Create: `scripts/lint/source-import-collector.ts`
- Create: `scripts/lint/source-import-collector.test.ts`
- Create: `scripts/lint/core-production-roots.ts`
- Create: `scripts/lint/core-production-roots.test.ts`
- Create: `scripts/typecheck/check-extension-workspaces.ts`
- Create: `scripts/typecheck/check-extension-workspaces.test.ts`
- Modify: `scripts/test.deno.json`
- Modify: `scripts/test-config-lock.test.ts`
- Regenerate: `scripts/deno.lock`
- Modify: `deno.json`
- Modify: `.github/workflows/cicd.yml`

- [ ] Add a real temporary-filesystem regression to `audit-core-deps-strict.test.ts` that creates `src/example.ts`, invokes the production collector, and asserts `visitedFileCount === 1`. Add a second empty-root case that rejects with `Core dependency audit found zero eligible production files`.

- [ ] Run the focused test and confirm the current collector fails because the `walk(".")` root is excluded:

  ```bash
  deno test --config=scripts/test.deno.json --frozen --no-check --allow-read --allow-write scripts/lint/audit-core-deps-strict.test.ts
  ```

- [ ] Implement the strict runner with explicit descendant exclusions. Make the collector accept a root directory, return `{ files, visitedFileCount }`, and reject zero eligible files before reporting success. Leave the currently wired legacy audit unchanged during this merge-ineligible phase; the post-inventory promotion plan removes it and promotes this strict runner to canonical `lint:core-deps` only after every inventory reaches zero.

- [ ] Give the strict runner distinct outcomes from its first commit: exit `0` only for complete evidence with zero policy issues, exit `2` for complete evidence with policy issues, and exit `3` for read/parse/traversal/config/ownership failure or incomplete evidence. Require `--output <path>` and atomically write its JSON result before returning `0` or `2`; the result contains `evidenceComplete`, `operationalErrors`, `issues`, and `examined: { roots, files }`. Tests prove a parser crash, missing manifest, zero-file traversal, missing output argument, and report-write failure can never be mistaken for the expected-red dependency result.

- [ ] Add a script-owned AST collector using exactly pinned `npm:@babel/parser@7.29.2` in `scripts/test.deno.json`/`scripts/deno.lock`. Walk `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, and `.cjs` production files. Collect static imports/exports, type imports, dynamic imports, `import("...")` type expressions, TS import-equals declarations, triple-slash type references, CommonJS `require()`/`require.resolve()`, aliases returned by `createRequire(import.meta.url)`, `import.meta.resolve()`, Web and Node workers, service-worker registration, `AudioWorklet.addModule()`, CSS worklet module loading, `importScripts()`, `module.register()`, and source locations. Resolve API bindings through imports/aliases rather than matching callee spelling, including aliased `node:worker_threads.Worker`. Every filesystem read, parse, binding-resolution, or traversal failure is a structured fatal audit error. The core audit must not import an extension implementation to parse its own boundary.

- [ ] Resolve immutable module-scope `const` chains and `new URL(<static-specifier>, import.meta.url)` expressions before classifying loaders. Add regressions for `import(SHARP_MODULE_SPECIFIER)`, `require.resolve("react")`, an aliased `createRequire` call, and a module worker URL. Any production loader argument that cannot be reduced to a concrete specifier is an `unresolved-runtime-loader` failure, including aliased/dynamic `require`, computed `import()`, computed worker/service-worker URLs, or `Function`/`eval` source that constructs a module load. Do not add comments, path exceptions, or an identifier allowlist; those callers must later move behind a typed first-party boundary or extension.

- [ ] Resolve relative, absolute `file:`, root import-map, and scoped import-map aliases before classifying an edge. Detect alias cycles, longest-prefix ambiguity, symlink/path escape, and target-specific builtins. Allow a resolved target only when it remains under `src/` or `cli/`, or is a builtin supported by that production target. Reject aliases into `extensions/**`, every `@veryfront/ext-*`, every `jsr:*`, `npm:*`, HTTP(S), `data:`, `blob:`, unresolvable bare packages, and any file URL outside the declared core roots.

- [ ] Define `core-production-roots.ts` as the single source/target-policy registry consumed again by Task 10. Each context declares a stable ID, target (`browser`, `node`, `deno`, or `universal`), production entrypoints, and effective config/manifest paths. `universal` expands to browser, Node, and Deno and accepts only the intersection of their importable builtin policies. Compute reachability separately per context; evaluate a shared file under every target that reaches it; and fail on any eligible production file that is neither reachable nor explicitly assigned to a context. Registry tests require every root Deno export and CLI/runtime entrypoint to belong to exactly one or more declared contexts and reject drift, duplicates, and an empty registry.

- [ ] Enumerate configuration-owned code edges for every registered production context: import-map `imports` and `scopes`, exports, runtime dependency/peer/optional/bundled fields, package roots, `jsxImportSource`, `jsxImportSourceTypes`, and `compilerOptions.types`. A vendor mapping is development-only only when resolved reachability proves no production context consumes it. Export one shared builtin classifier: only names present in the runtime's canonical `node:` builtin set are importable builtins for Node/Deno contexts; browser permits none; `universal` requires acceptance by all three targets. Deno globals create no import edge. Reject fake `node:` names, `jsr:`, `deno:`, `ext:`, bare, and unknown schemes; table tests cover each plus `node:fs` under Node, Deno, browser, and universal.

- [ ] Update the table tests to cover every required edge, constant indirection, CommonJS resolution, hostile syntax, and unresolved runtime loaders. Delete assertions that currently permit `jsr:@std/*`, `@veryfront/ext-*`, or unresolved aliases.

- [ ] Add `check-extension-workspaces.ts`. It must read root workspace members, enumerate each extension manifest's concrete exported `.ts` entrypoints, require a nonzero entrypoint count per package and globally, invoke `deno check` with the member directory's `deno.json` path, `--frozen`, and the enumerated export targets as separate arguments, and reject output containing `No matching files found` even when Deno exits zero.

- [ ] Add script tests for a zero-export manifest, Deno's zero-file warning, a failed check, and a successful multi-entrypoint check using an injected command runner.

- [ ] Remove the top-level `"extensions/"` exclusion and the Parse5 negation from root `deno.json`. Add `typecheck:extensions` and include it in both `verify:quick` and `verify`. Add `lint:core-deps:strict` as a separately invokable expected-red evidence task, but do not replace the aggregate `lint:core-deps` command until the later owner-specific extraction plans make every inventory green.

- [ ] Define `lint:core-deps:strict` with `--config=scripts/test.deno.json --frozen` and only the permissions required to read its registered inputs and write an explicitly requested report. Add a task source-contract test so removing the isolated config or frozen lock is an operational failure, not an alternate resolution path.

- [ ] Put `--frozen` on every nested `deno run` child in the root `generate` and `generate:manifests:check` task definitions; an outer `deno task --frozen` does not propagate that flag to task-owned child processes. Extend `scripts/test-config-lock.test.ts` to parse both task bodies and fail if any generator child, including later Task 3 metadata generation, lacks `--frozen`. A regression removes one nested flag and proves the task contract fails.

- [ ] Because the removed root exclusion also changes bare CI formatting discovery, run `deno fmt extensions/` once and add `fmt:extensions:check` over the complete workspace extension tree. Wire it into `fmt:check` and the CI format path so local/pre-push/CI scopes agree; a zero-file extension format check fails. Keep this commit's extension-only formatting changes mechanical and review the diff separately from behavior changes.

- [ ] Preserve explicit root test scope after removing the exclusion. Add a configuration regression proving root `test.include` contains only `src/`, `cli/`, `react/`, and `tests/`, while member checks enumerate nonzero extension files. Root test/coverage tasks must not discover extension suites under the wrong config.

- [ ] Register `source-import-collector.test.ts`, `core-production-roots.test.ts`, `audit-core-deps-strict.test.ts`, and `check-extension-workspaces.test.ts` in `test:scripts`. Extend `scripts/test-config-lock.test.ts` to enumerate eligible script test files and fail when a file is neither explicitly registered nor assigned to a documented separate config/task; zero discovered script tests is also an error.

- [ ] Add the same extension type-check gate to CI before package build/publish. Run `test:scripts` from canonical full `verify` and CI so audit regressions are blocking. Do not wire the expected-red strict dependency command into merge/release CI yet; the follow-up dependency-extraction phase performs that one-way gate promotion only after zero violations.

- [ ] Run:

  ```bash
  set -euo pipefail
  deno fmt scripts/lint/audit-core-deps-strict.ts scripts/lint/audit-core-deps-strict.test.ts scripts/lint/source-import-collector.ts scripts/lint/source-import-collector.test.ts scripts/lint/core-production-roots.ts scripts/lint/core-production-roots.test.ts scripts/typecheck/check-extension-workspaces.ts scripts/typecheck/check-extension-workspaces.test.ts scripts/test.deno.json deno.json .github/workflows/cicd.yml
  deno test --config=scripts/test.deno.json --frozen --no-check --allow-read --allow-write --allow-run scripts/lint/source-import-collector.test.ts scripts/lint/core-production-roots.test.ts scripts/lint/audit-core-deps-strict.test.ts scripts/typecheck/check-extension-workspaces.test.ts
  deno fmt extensions/
  deno task fmt:extensions:check
  deno task typecheck:extensions
  deno task verify:quick
  ```

- [ ] Run the strict source audit, save its unsuppressed report for Task 10, and prove the expected-red result is complete rather than operationally broken:

  ```bash
  set -euo pipefail
  strict_report_dir="$(mktemp -d)"
  trap 'rm -rf -- "${strict_report_dir:?}"' EXIT
  strict_status=0
  deno task lint:core-deps:strict --output "$strict_report_dir/source-dependencies.json" || strict_status=$?
  test "$strict_status" -eq 2
  deno eval 'const report = JSON.parse(await Deno.readTextFile(Deno.args[0])); const examined = report.examined; if (report.evidenceComplete !== true || report.operationalErrors?.length !== 0 || !Array.isArray(report.issues) || report.issues.length === 0 || !examined || !Number.isInteger(examined.roots) || examined.roots < 1 || !Number.isInteger(examined.files) || examined.files < 1) Deno.exit(1);' "$strict_report_dir/source-dependencies.json"
  ```

  Exit `3` is a broken audit, not acceptable expected-red evidence. Do not add baselines or exceptions, call this checkpoint globally dependency-clean, or merge/release while the command is red.

- [ ] Commit and push:

  ```bash
  set -euo pipefail
  git add scripts/lint/audit-core-deps-strict.ts scripts/lint/audit-core-deps-strict.test.ts scripts/lint/source-import-collector.ts scripts/lint/source-import-collector.test.ts scripts/lint/core-production-roots.ts scripts/lint/core-production-roots.test.ts scripts/typecheck/check-extension-workspaces.ts scripts/typecheck/check-extension-workspaces.test.ts scripts/test.deno.json scripts/deno.lock scripts/test-config-lock.test.ts deno.json .github/workflows/cicd.yml extensions
  git commit -m "build: add strict dependency evidence"
  git push origin codex/module-reconcile-20260723
  ```

## Task 2: Define the generic contract and a testable dispatcher without switching consumers

**Files:**

- Create: `src/extensions/observability/application-error-reporter.ts`
- Create: `src/extensions/observability/application-error-reporter.test.ts`
- Modify: `src/extensions/observability/index.ts`
- Create: `src/extensions/contract-registry-internal.ts`
- Create: `src/extensions/contract-registry-internal.test.ts`
- Modify: `src/extensions/contracts.ts`
- Modify: `src/extensions/contracts.test.ts`
- Create: `src/observability/application-error-dispatcher.ts`
- Create: `src/observability/application-error-dispatcher.test.ts`
- Modify: `scripts/lint/extension-source-metadata.ts`
- Modify: `scripts/lint/audit-extension-contracts.test.ts`

- [ ] Write contract tests that reject null, arrays, missing methods, non-callable methods, and hostile accessors, and accept an object with callable `capture` and `flush` methods.

- [ ] Add this contract surface:

  ```ts
  export const ApplicationErrorReporterName = "ApplicationErrorReporter" as const;
  export const APPLICATION_ERROR_FLUSH_DEFAULT_MS = 2_000;
  export const APPLICATION_ERROR_FLUSH_MIN_MS = 1;
  export const APPLICATION_ERROR_FLUSH_MAX_MS = 30_000;

  export interface ApplicationErrorContext {
    boundary: string;
    method?: string;
    requestId?: string;
    spanId?: string;
    traceId?: string;
    attributes?: Record<string, string | number | boolean>;
  }

  export interface ApplicationErrorReporter {
    capture(error: unknown, context: ApplicationErrorContext): string | undefined;
    flush(timeoutMs: number): Promise<boolean>;
  }

  export function assertApplicationErrorReporter(
    value: unknown,
  ): asserts value is ApplicationErrorReporter;
  ```

  Implement validation with `assertRegistrationMethod()` so hostile accessors become contextual `TypeError`s.

- [ ] Move registry state into `contract-registry-internal.ts`, which is not exported from `deno.json`, `src/extensions/index.ts`, or npm package exports. Store a monotonically increasing registration generation per contract entry and increment it on every register/unregister/reset mutation so replacing or re-registering the same implementation object can never reuse an identity. Keep the generic versioned lookup internal:

  ```ts
  interface VersionedContract<T> {
    implementation: T;
    generation: number;
  }

  function tryResolveVersioned<T>(name: string): VersionedContract<T> | undefined;
  ```

  Test replacement, unregister/register, and re-registering the same object after a reset; every new entry receives a new generation and stale observations cannot be confused with the current one.

- [ ] Reserve `ApplicationErrorReporterName` inside the internal registry. Public `register()`, `unregister()`, and `reset()` from `veryfront/extensions/contracts` may mutate only ordinary/manual contracts: registering or unregistering the reserved name throws, and reset leaves a loader-owned reporter untouched. The internal registry exposes an opaque, unforgeable loader authority only to relative core imports; its minting/mutation functions are absent from every public barrel and package export. Only `orchestrateConfiguredExtensions()` may mint a reporter authority, and only after it has acquired the runtime owner and preflighted exactly one enabled direct provider. Raw `ExtensionLoader`, legacy discovery, primed contracts, built-ins, `beforeActivate`, and manual registry calls receive no such authority and cannot publish, replace, or clear the reporter.

- [ ] Record internal reporter provenance as `{ source: "configured-extension", runtimeOwner, loaderGeneration }`. The loader publishes and revokes it with compare-by-owner-and-generation operations so stale teardown cannot clear a newer reporter. Expose an internal `tryResolveConfiguredVersioned()` that returns a reporter only when its provenance matches the coordinator's current configured owner/generation; the dispatcher must use that resolver rather than the public generic registry lookup. Add tests for public/manual register, unregister, and reset attempts plus raw-loader, legacy-loader, primed-contract, built-in, and `beforeActivate` bypass attempts. Cover both disabled and enabled modes and prove none becomes facade-visible outside the accepted configured provider's setup-to-teardown lifetime.

- [ ] Implement `createApplicationErrorDispatcher()` as a testable internal object with injected versioned reporter resolution, timeout scheduling, and a local diagnostic sink. It snapshots/sanitizes context, catches provider failures, and defensively suppresses a repeated capture of the same error within one registry generation. Use a `WeakSet<object>` plus a deterministic FIFO-bounded 128-entry primitive set per generation, and reset both when the generation changes. Lifecycle exactly-once semantics come from Task 6's exclusive owners, not from this identity cache.

- [ ] Preserve the existing expected-error policy inside the dispatcher: a `DOMException` whose name is `AbortError` returns `undefined` before reporter resolution and never reaches `capture`. Add focused tests for an actual `AbortError`, an ordinary `DOMException`, a non-DOM error, and a hostile value whose prototype inspection throws. Task 9 must repeat this assertion through the public facade so the cutover cannot regress cancellation filtering.

- [ ] The dispatcher emits at most one sanitized, non-recursive local diagnostic per generation. Its sink receives only `{ operation: "capture", generation, message }`; reporter exceptions are converted through the existing telemetry sanitizer before emission. Sink failure is swallowed and a recursion guard prevents the sink from reporting through the same dispatcher.

- [ ] Make dispatcher `flush(timeoutMs = 2_000)` validate the inclusive 1–30,000 ms range before provider invocation, always pass an explicit deadline, race the provider against that deadline, and return `false` for invalid input, rejection, timeout, or provider `false`. Absence remains `true` because reporting is disabled. Cancel the injected deadline timer in `finally` on every settlement; tests assert no pending timer remains.

- [ ] Do not switch `src/observability/application-errors.ts` or remove `setApplicationErrorReporter()` in this checkpoint. Existing Sentry/agent/test consumers still use it. Task 9 atomically swaps the public facade to the tested dispatcher and removes every setter consumer, avoiding a hybrid dual-owner compatibility path.

- [ ] Add `ApplicationErrorReporterName` to `KNOWN_CONTRACT_CONSTANTS` and add a metadata synchronization test.

- [ ] Run:

  ```bash
  set -euo pipefail
  deno test --frozen --allow-all src/extensions/observability/application-error-reporter.test.ts src/extensions/contract-registry-internal.test.ts src/extensions/contracts.test.ts src/observability/application-error-dispatcher.test.ts
  deno test --config=scripts/test.deno.json --frozen --no-check --allow-read scripts/lint/audit-extension-contracts.test.ts
  deno check --frozen src/extensions/observability/index.ts src/observability/application-error-dispatcher.ts
  ```

- [ ] Commit and push:

  ```bash
  set -euo pipefail
  git add src/extensions/observability/application-error-reporter.ts src/extensions/observability/application-error-reporter.test.ts src/extensions/observability/index.ts src/extensions/contract-registry-internal.ts src/extensions/contract-registry-internal.test.ts src/extensions/contracts.ts src/extensions/contracts.test.ts src/observability/application-error-dispatcher.ts src/observability/application-error-dispatcher.test.ts scripts/lint/extension-source-metadata.ts scripts/lint/audit-extension-contracts.test.ts
  git commit -m "feat: add application error reporter contract"
  git push origin codex/module-reconcile-20260723
  ```

## Task 3: Require explicit activation and add config-only orchestration

**Files:**

- Modify: `src/extensions/discovery.ts`
- Modify: `src/extensions/discovery.test.ts`
- Modify: `src/extensions/orchestrate.ts`
- Modify: `src/extensions/orchestrate.test.ts`
- Modify: `src/extensions/index.ts`
- Modify: `src/extensions/deferred-extension.ts`
- Create: `src/extensions/deferred-extension.test.ts`
- Modify: `src/extensions/builtin-extensions.ts`
- Modify: `src/extensions/builtin-extensions.test.ts`
- Create: `src/extensions/builtin-extension-metadata.generated.ts`
- Modify: `src/extensions/loader.ts`
- Modify: `src/extensions/loader.test.ts`
- Create: `scripts/build/generate-builtin-extension-metadata.ts`
- Create: `scripts/build/generate-builtin-extension-metadata.test.ts`
- Modify: `scripts/build/npm-extension-package-metadata.ts`
- Modify: `scripts/build/npm-extension-package-metadata.test.ts`
- Modify: `src/config/schemas/config.schema.ts`
- Modify: `src/config/schemas/config.schema.test.ts`
- Modify: `src/config/runtime-config.ts`
- Modify: `src/config/runtime-config.test.ts`
- Modify: `deno.json`

- [ ] Add discovery tests for `veryfront.activation: "explicit"`, default `"auto"`, and an invalid activation value. Invalid metadata must fail with a package-specific error; it must not silently become auto activation.

- [ ] Extend `PackageMetadata` and build metadata with `activation: "auto" | "explicit"`. Preserve `"explicit"` in generated npm manifests.

- [ ] Change package auto-discovery so explicit packages remain discoverable as metadata but are excluded from automatic factory loading. Add a test proving an installed explicit package is never imported.

- [ ] Add a serialized `orchestrateConfiguredExtensions()` entrypoint that reuses the same active-loader generation coordinator as `orchestrateExtensions()`, snapshots all enumerable data properties before side effects, and performs no package/project/local discovery. Define and export its complete API before implementation:

  ```ts
  export interface ApplicationErrorActivation {
    readonly enabled: boolean;
    readonly flushTimeoutMs?: number;
  }

  export interface ConfiguredExtensionRuntimeConfig extends Readonly<Record<string, unknown>> {
    readonly extensions?: readonly ExtensionConfigEntry[];
    readonly observability?: Readonly<{
      applicationErrors?: ApplicationErrorActivation;
    }>;
  }

  export interface OrchestrateConfiguredExtensionsOptions {
    readonly config: ConfiguredExtensionRuntimeConfig;
    readonly logger: ExtensionLogger;
    readonly runtimeOwner: ExtensionRuntimeOwner;
    readonly primeContracts?: Readonly<Record<string, unknown>>;
    readonly builtinExtensions?: readonly ResolvedExtension[];
    readonly setupTimeoutMs?: number;
    readonly teardownTimeoutMs?: number;
    readonly beforeActivate?: () => void | Promise<void>;
    readonly observers?: ExtensionLifecycleObservers;
  }

  export function orchestrateConfiguredExtensions(
    options: OrchestrateConfiguredExtensionsOptions,
  ): Promise<ExtensionLoader>;
  ```

  `ExtensionRuntimeOwner` is an opaque token returned by `createExtensionRuntimeOwner(label)`. The coordinator permits replacement only by the same owner (hot reload/retry); a different live server/proxy/agent owner fails before teardown, and successful final teardown releases that owner. The legacy discovery orchestrator shares the coordinator and cannot displace a configured runtime. Update shared orchestration option types to readonly where they consume the same values. When reporting is disabled, this API performs no reporter factory loading, reporter contract resolution, or reporter setup; unrelated configured and built-in extensions retain their normal lifecycle. Importing and constructing the application's explicit config occurs before this API and is not misrepresented as lazy loading. Add public-export/compile fixtures for every option plus concurrent-owner rejection, same-owner replacement, failed-teardown retention, and sequential-owner tests.

- [ ] Export the config-only coordinator and its option types from `src/extensions/index.ts`. Add a public-consumer check so hosts never require a deep `src/extensions/orchestrate.ts` import.

- [ ] Add two-phase generic explicit-contract preflight without materializing a deferred factory. Phase one recursively inspects concrete config entries/presets plus declared deferred metadata before any import; a direct top-level configured reporter provider is the only accepted form. Extend the deferred API with mandatory immutable metadata:

  ```ts
  export interface DeferredExtensionState {
    readonly expectedName: string;
    readonly declaredContracts: Readonly<{
      provides: readonly string[];
      requires: readonly string[];
    }>;
    readonly load: (logger: ExtensionLogger) => Promise<Extension | undefined>;
  }
  ```

  `createDeferredResolvedExtension()` requires `declaredContracts`; `ResolvedExtension.source` and `origin` remain its provenance. Generate optional built-in declarations into one named runtime artifact from the same workspace manifest metadata used by discovery—never maintain a second handwritten contract list or import an implementation to inspect it. Config-only orchestration inspects only concrete configured entries and supplied descriptors and therefore loads no hidden reporter. The legacy full-discovery path may load project/local factories to learn metadata, but must reject a reporter before setup and is not used by the official reporting composition roots. Phase two verifies set equality between each loaded implementation's normalized actual `contracts` and its declared metadata before any setup; mismatch aborts startup and cannot be treated as disabled or unrelated. Package/build audits verify declaration alignment so metadata cannot become a hiding place. Reject a reporter provider with any `contracts.requires`; the one accepted direct provider initializes first and tears down last without special-casing a Sentry package name.

- [ ] Implement and test this complete activation table before any setup side effect:

  | `applicationErrors`  | Direct configured provider                                                      | Result                                                     |
  | -------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------- |
  | absent               | none                                                                            | reporting disabled; no reporter discovery/resolution/setup |
  | `{ enabled: false }` | none                                                                            | reporting disabled; no reporter discovery/resolution/setup |
  | absent or disabled   | one or more                                                                     | configuration error                                        |
  | `{ enabled: true }`  | none or only a disable directive                                                | missing-extension startup error                            |
  | `{ enabled: true }`  | exactly one                                                                     | setup that provider                                        |
  | `{ enabled: true }`  | duplicate, preset-hidden, deferred, project, local, or auto-discovered provider | explicit-activation startup error                          |

- [ ] Treat the reporter reservation as part of preflight, not a convention. Reject `ApplicationErrorReporterName` in `primeContracts` and built-in descriptors before `beforeActivate` or any setup runs. A disabled orchestration never mints reporter authority. An enabled orchestration mints it only after the direct-provider cardinality check and binds it to the acquired runtime owner plus loader generation; the loader consumes it only while setting up that exact provider. Public/manual registration from `beforeActivate` fails through the reserved-name guard. Legacy discovery and a raw `ExtensionLoader` have no authority and reject any reporter declaration before setup. Add table-driven bypass tests for primes, built-ins, `beforeActivate`, raw loader, and legacy discovery under both enabled and disabled reporting.

- [ ] Define persistent observer ownership at loader construction and expose it through both orchestration option types:

  ```ts
  export interface ExtensionLifecycleObservers {
    onSetupFailure?(extensionName: string, error: unknown): void;
    onTeardownFailure?(extensionName: string, error: unknown): void;
  }
  ```

  `new ExtensionLoader(logger, { observers })` snapshots the synchronous callbacks and retains them through teardown retries. Observers only capture locally through the currently live reporter; they never flush or perform asynchronous work. `onSetupFailure` runs while already published contracts are live and before rollback; `onTeardownFailure` runs immediately after each non-reporter teardown hook failure while the reporter remains live. Teardown is a barrier: all non-reporter records must settle successfully before reporter teardown begins. On rejection/timeout, retain the untouched reporter record and registry contract, perform an explicit bounded flush while ownership remains, and permit only a serialized retry after the late-settlement barrier. Immediately before reporter teardown, revoke its public contract; its internal record owns flush/close and retry, so a failed or partly closed reporter is never still resolvable. Reporter setup/teardown failures are diagnosed locally and never sent through that reporter. Add a bounded `teardownTimeoutMs` with late-settlement quarantine to both orchestration options. Observer failure is logged locally and cannot replace or suppress the lifecycle error. Cover timeout, rollback, reverse order, retry, observer-throws, unrelated teardown failure, reporter failure, closed-reporter non-resolution, and exactly-one-provider-flush cases in `loader.test.ts`.

  `teardownTimeoutMs` defaults to 30,000 and accepts only safe integers from 1 through 30,000 for production orchestration; there is no unbounded/zero production mode. A timed-out hook remains quarantined until its promise settles, and no later provider teardown or generation activation can overlap it.

- [ ] Add strict config schema support:

  ```ts
  observability: {
    applicationErrors?: {
      enabled: boolean;
      flushTimeoutMs?: number;
    };
  }
  ```

  Validate `flushTimeoutMs` as an integer from 1 through 30,000. Preserve this generic section in normal runtime config and explicitly define its proxy-mode behavior; never parse a vendor selector.

- [ ] Add tests proving disabled reporting performs no reporter factory loading, reporter contract resolution, or reporter setup; enabled reporting with none fails; duplicate/preset/deferred providers fail before setup; and config-only orchestration performs zero package/project/local discovery calls.

- [ ] Add `generate-builtin-extension-metadata.test.ts` to `test:scripts`, wire generation plus `--check` into `generate`/`generate:manifests:check` with `--frozen` on each nested `deno run`, and run the script-test registration and task-lock regressions.

- [ ] Run:

  ```bash
  set -euo pipefail
  deno test --frozen --allow-all src/extensions/discovery.test.ts src/extensions/orchestrate.test.ts src/extensions/deferred-extension.test.ts src/extensions/builtin-extensions.test.ts src/extensions/loader.test.ts src/config/schemas/config.schema.test.ts src/config/runtime-config.test.ts
  deno test --config=scripts/test.deno.json --frozen --no-check --allow-read --allow-write scripts/build/npm-extension-package-metadata.test.ts scripts/build/generate-builtin-extension-metadata.test.ts scripts/test-config-lock.test.ts
  deno run --config=scripts/test.deno.json --frozen --allow-read --allow-write scripts/build/generate-builtin-extension-metadata.ts --check
  deno check --frozen src/extensions/orchestrate.ts src/config/runtime-config.ts
  ```

- [ ] Commit and push:

  ```bash
  set -euo pipefail
  git add src/extensions/discovery.ts src/extensions/discovery.test.ts src/extensions/orchestrate.ts src/extensions/orchestrate.test.ts src/extensions/index.ts src/extensions/deferred-extension.ts src/extensions/deferred-extension.test.ts src/extensions/builtin-extensions.ts src/extensions/builtin-extensions.test.ts src/extensions/builtin-extension-metadata.generated.ts src/extensions/loader.ts src/extensions/loader.test.ts scripts/build/npm-extension-package-metadata.ts scripts/build/npm-extension-package-metadata.test.ts scripts/build/generate-builtin-extension-metadata.ts scripts/build/generate-builtin-extension-metadata.test.ts src/config/schemas/config.schema.ts src/config/schemas/config.schema.test.ts src/config/runtime-config.ts src/config/runtime-config.test.ts deno.json
  git commit -m "feat: require explicit reporter activation"
  git push origin codex/module-reconcile-20260723
  ```

## Task 4: Build the Node Sentry provider package

**Files:**

- Create: `extensions/_shared/observability-sentry/config.ts`
- Create: `extensions/_shared/observability-sentry/policy.ts`
- Create: `extensions/_shared/observability-sentry/policy.test.ts`
- Create: `extensions/ext-observability-sentry-node/deno.json`
- Create: `extensions/ext-observability-sentry-node/README.md`
- Create: `extensions/ext-observability-sentry-node/src/index.ts`
- Create: `extensions/ext-observability-sentry-node/src/index.test.ts`
- Create: `extensions/ext-observability-sentry-node/src/internal-sdk.ts`
- Modify: `deno.json`
- Regenerate: `deno.lock`
- Modify: `scripts/lint/audit-extension-capabilities.test.ts`

- [ ] Port policy/redaction tests to the extension-owned shared directory. Remove catches from capture and flush policy adapters so the core facade observes failures truthfully.

- [ ] Define a vendor-SDK-type-free public configuration:

  ```ts
  export interface SentryNodeConfig {
    dsn: string;
    serviceName: string;
    environment?: string;
    release?: string;
  }

  export function sentryNode(config: SentryNodeConfig): Extension;
  export default sentryNode;
  ```

  Keep the SDK adapter/injection type in `internal-sdk.ts`; no exported signature may use `typeof Sentry`, `Parameters<typeof Sentry.init>`, or an `@sentry/node` type.

- [ ] Write red tests for blank DSN/service name, init failure without contract publication, capture propagation, false/rejected/hanging flush, false/rejected/hanging close, initialization exactly once, one overall configured teardown deadline (default 2,000 ms), late settlement without overlapping retry, retryable teardown, and manifest/factory contract alignment.

- [ ] Implement an extension named `ext-observability-sentry-node` with `contracts.provides: [ApplicationErrorReporterName]`. Validate all provider config before `Sentry.init`, publish only after successful initialization, and read the single authoritative deadline from generic `ctx.config.observability.applicationErrors.flushTimeoutMs` (default 2,000 ms). Teardown computes one absolute deadline shared by flush and close, races never-settling SDK calls, retains their late-settlement barrier, and never starts an overlapping retry or reinitializes the SDK.

- [ ] Give the package one root export, exactly one pinned `@sentry/node` import, `veryfront/extensions/observability` and `veryfront/extensions` first-party imports, `veryfront.activation: "explicit"`, the exact `ApplicationErrorReporter` provided contract, and outbound network capability. The required public config supplies DSN/service data, so the extension declares no environment-read capability and does not read `SENTRY_*` itself.

- [ ] Add the Node member alongside the still-working combined package. Do not reference the Deno member before Task 5 creates it, and do not delete the combined package while old core/CLI/agent consumers still import it.

- [ ] Regenerate and freeze the root lock after adding the workspace member:

  ```bash
  set -euo pipefail
  deno install
  deno install --frozen
  ```

- [ ] Run:

  ```bash
  set -euo pipefail
  deno fmt extensions/_shared/observability-sentry extensions/ext-observability-sentry-node
  deno test --config=extensions/ext-observability-sentry-node/deno.json --frozen --allow-all extensions/ext-observability-sentry-node/src/index.test.ts extensions/_shared/observability-sentry/policy.test.ts
  deno check --config=extensions/ext-observability-sentry-node/deno.json --frozen extensions/ext-observability-sentry-node/src/index.ts
  deno task lint:extension-contracts
  deno task lint:extension-capabilities
  ```

- [ ] Commit and push the independently valid Node package:

  ```bash
  set -euo pipefail
  git add extensions/_shared/observability-sentry extensions/ext-observability-sentry-node deno.json deno.lock scripts/lint/audit-extension-capabilities.test.ts
  git commit -m "feat: add explicit Node Sentry reporter extension"
  git push origin codex/module-reconcile-20260723
  ```

## Task 5: Build the Deno Sentry provider package and regenerate ownership

**Files:**

- Create: `extensions/ext-observability-sentry-deno/deno.json`
- Create: `extensions/ext-observability-sentry-deno/README.md`
- Create: `extensions/ext-observability-sentry-deno/src/index.ts`
- Create: `extensions/ext-observability-sentry-deno/src/index.test.ts`
- Create: `extensions/ext-observability-sentry-deno/src/internal-sdk.ts`
- Create: `scripts/lint/audit-extension-dependency-ownership.ts`
- Create: `scripts/lint/audit-extension-dependency-ownership.test.ts`
- Modify: `deno.json`
- Regenerate: `deno.lock`

- [ ] Mirror the Node red tests for Deno, including the disabled Deno integration policy, false/rejected/hanging flush and close under one overall deadline, retained late-settlement ownership, and the absence of any `@sentry/node` edge.

- [ ] Expose only:

  ```ts
  export interface SentryDenoConfig {
    dsn: string;
    serviceName: string;
    environment?: string;
    release?: string;
  }

  export function sentryDeno(config: SentryDenoConfig): Extension;
  export default sentryDeno;
  ```

- [ ] Give the package one pinned `@sentry/deno` import and no Node SDK. Use `veryfront.activation: "explicit"`, matching contract/capability metadata, validate before init, publish after init, and implement bounded retryable flush/close teardown.

- [ ] Keep the combined extension until the atomic consumer cutover in Task 9. Keep shared source under `extensions/_shared`; each dnt build must embed it and must not emit a path back into the repository.

- [ ] Regenerate the root lock with Deno 2.7.7 and verify frozen resolution:

  ```bash
  set -euo pipefail
  deno install
  deno install --frozen
  deno task typecheck:extensions
  ```

- [ ] Implement `audit-extension-dependency-ownership.ts` and tests. Given a workspace manifest plus the root lock, it computes the full reachable npm graph and fails on an undeclared edge or forbidden sibling SDK. Assert the Node provider has exactly one direct SDK root, `@sentry/node`, and every transitive npm node is reachable through that declared closure; assert the Deno equivalent for `@sentry/deno`. Neither graph may reach the sibling SDK or an unrelated direct vendor root. The temporary legacy combined member may still reach both until Task 9; do not mistake global lock presence for ownership.

- [ ] Add `scripts/lint/audit-extension-dependency-ownership.test.ts` to `test:scripts` and run the script-test registration regression.

- [ ] Run both extension suites and contract/capability audits:

  ```bash
  set -euo pipefail
  deno test --config=extensions/ext-observability-sentry-node/deno.json --frozen --allow-all extensions/ext-observability-sentry-node/src/index.test.ts extensions/_shared/observability-sentry/policy.test.ts
  deno test --config=extensions/ext-observability-sentry-deno/deno.json --frozen --allow-all extensions/ext-observability-sentry-deno/src/index.test.ts
  deno task lint:extension-contracts
  deno task lint:extension-capabilities
  deno task typecheck:extensions
  deno test --config=scripts/test.deno.json --frozen --no-check --allow-read scripts/lint/audit-extension-dependency-ownership.test.ts
  deno run --config=scripts/test.deno.json --frozen --allow-read scripts/lint/audit-extension-dependency-ownership.ts
  ```

- [ ] Commit and push:

  ```bash
  set -euo pipefail
  git add extensions/ext-observability-sentry-deno scripts/lint/audit-extension-dependency-ownership.ts scripts/lint/audit-extension-dependency-ownership.test.ts deno.json deno.lock
  git commit -m "feat: add explicit Deno Sentry reporter extension"
  git push origin codex/module-reconcile-20260723
  ```

## Task 6: Build dormant shared server reporter lifecycle primitives

Tasks 6–8 build additive, dormant generic lifecycle seams and are separately testable recovery checkpoints. They must not switch an existing production entrypoint, invoke both reporter owners, or remove the legacy owner. Task 9 is the atomic activation-and-artifact commit: it switches every production entrypoint, removes the legacy owner and stale consumer/artifact mappings in the same tree, and proves there is no hybrid path. Intermediate commits are branch-only and merge/release-ineligible, but remain focused-test green and are pushed for recovery.

**Files:**

- Create: `src/server/application-error-runtime.ts`
- Create: `src/server/application-error-runtime.test.ts`
- Create: `cli/shared/application-error-handlers.ts`
- Create: `cli/shared/application-error-handlers.test.ts`

- [ ] Build an unexported server composition primitive around `orchestrateConfiguredExtensions()` and the dispatcher. Add tests for disabled reporting, enabled/missing provider, structurally invalid provider, provider setup failure, sequential generations, and validation before a supplied request-acceptance callback. No existing production server or CLI entrypoint calls this primitive until Task 9.

- [ ] Define and snapshot this internal host input before any injected acquisition callback:

  ```ts
  extensions?: readonly ExtensionConfigEntry[];
  applicationErrors?: {
    enabled: boolean;
    flushTimeoutMs?: number;
  };
  ```

  Each supplied field authoritatively replaces that field from project config; an omitted field uses project config. The helper forwards full runtime config, primed contracts, required built-ins, setup timeout, observers, activation callback, tracing-transition input, and FS-ownership input without dropping them. Add mutation/hostile-getter snapshot tests. Task 9 adds these fields to production/dev/public `startServer()` options and verifies public forwarding.

- [ ] Resolve and validate `ApplicationErrorReporterName` only when generic reporting is enabled. Keep the contract registry as the single reporter owner; do not add a Sentry import or a second global setter.

- [ ] Implement an injected two-phase cleanup coordinator; Task 9 adapts the existing server disposer and keeps public `ServerHandle.stop()` composite:

  ```ts
  type RuntimeCleanupResult = { failures: readonly unknown[]; settled: boolean };
  cleanupRuntimeConsumers(): Promise<RuntimeCleanupResult>;
  disposeBootstrapAfterRuntime(): Promise<void>;
  ```

  The coordinator accepts named consumer stop/quiescence barriers. A rejection is unsettled unless that consumer's explicit closed/aborted barrier confirms quiescence. For an unsettled consumer, capture each failure, bounded-flush through the still-live provider, retain bootstrap/extension ownership, and reject so a later `stop()` can retry without overlap. Only a fully settled consumer phase may call `disposeBootstrapAfterRuntime()`. The loader then reports each extension teardown failure through its lifecycle observer while the reporter is live and eventually runs the reporter-owned flush/close; successful teardown clears the registry. Release process ownership only after both phases succeed.

- [ ] Configure a setup-failure observer that captures `process.startup` before loader rollback only when the reporter already initialized. The facade's reporter/error identity suppression prevents an outer retry/cleanup owner from delivering the same error twice.

- [ ] Add primitive tests proving the provider remains available through a simulated ready state, captures cleanup failure before bootstrap disposal, and is absent only after successful stop. Add a retry test proving failed teardown cannot let a stale lifecycle clear a newer generation. Task 9 repeats these assertions through real production/dev handles.

- [ ] Define an explicit reporting-owner table in tests: extension setup failure → loader observer; post-setup bootstrap/readiness failure → the first failing host boundary; listener bind failure → `onStartupError`; runtime/listener failure → shutdown coordinator; consumer cleanup failure → cleanup coordinator. Outer CLI/process wrappers may log or aggregate but never recapture an owned error. Test `AggregateError` and `BootstrapCleanupError` wrapping the original failure to prove exactly-once does not depend on object identity.

  Internal coordinator results carry `{ error: unknown; captureAttempted: true }` after the owning boundary attempts capture. Aggregators preserve that record as data rather than manufacturing an unowned error path; `captureAttempted` means no outer retry even when the reporter returned `undefined` or threw. This marker is internal lifecycle state, not a public error subclass or mutable property on the user's error.

- [ ] Add provider-neutral CLI startup/global-error/shutdown handlers as injected pure functions. They are not imported by current commands in this checkpoint. Do not expose a compatibility selector between the two designs; Task 9 performs the one-way entrypoint switch and deletion.

- [ ] Keep startup error semantics: if a provider completed initialization, the synchronous setup-failure observer captures the original error once, then the reporter extension's rollback teardown performs the sole bounded flush before closing. The host must not issue a second flush. If provider initialization itself failed, propagate that failure without pretending it was remotely captured.

- [ ] Prepare provider-neutral `vf start` global-error and shutdown handlers as directly testable functions, but leave the production command wiring unchanged until Task 9. A shutdown cleanup or false flush must produce a nonzero result; do not suppress and report success.

- [ ] Run:

  ```bash
  set -euo pipefail
  deno test --frozen --allow-all src/server/application-error-runtime.test.ts cli/shared/application-error-handlers.test.ts
  deno check --frozen src/server/application-error-runtime.ts cli/shared/application-error-handlers.ts
  reporter_scan_status=0
  rg -n 'Sentry|SENTRY_|observability/sentry|ext-observability-sentry' src/server/application-error-runtime.ts cli/shared/application-error-handlers.ts || reporter_scan_status=$?
  case "$reporter_scan_status" in
    0) echo "Reporter implementation reference found in generic server lifecycle" >&2; exit 1 ;;
    1) ;;
    *) echo "Server reporter scan failed" >&2; exit "$reporter_scan_status" ;;
  esac
  ```

  The search must return no match.

- [ ] Commit and push the additive checkpoint after its focused tests and `git diff --check` pass:

  ```bash
  set -euo pipefail
  git add src/server/application-error-runtime.ts src/server/application-error-runtime.test.ts cli/shared/application-error-handlers.ts cli/shared/application-error-handlers.test.ts
  git commit -m "refactor: prepare generic server error lifecycle"
  git push origin codex/module-reconcile-20260723
  ```

## Task 7: Refactor proxy startup into a generic composition root

**Files:**

- Create: `src/proxy/runtime.ts`
- Create: `src/proxy/runtime.test.ts`
- Modify: `src/proxy/main.ts`
- Modify: `src/proxy/main.test.ts`
- Modify: `src/proxy/startup-rollback.ts`
- Modify: `src/proxy/startup-rollback.test.ts`
- Modify: `src/proxy/shutdown.ts`
- Modify: `src/proxy/shutdown.test.ts`
- Modify: `src/proxy/shutdown-coordinator.ts`
- Modify: `src/proxy/shutdown-coordinator.test.ts`

- [ ] Extract a process-exit-free callable runtime with an internal provider-neutral lifecycle dependency and public-style handle. The existing `main.ts` supplies exactly one adapter around its existing legacy facade in this checkpoint, preserving behavior without running two owners:

  ```ts
  interface ProxyApplicationErrorLifecycle {
    capture(error: unknown, context: ApplicationErrorContext): string | undefined;
    flush(timeoutMs: number): Promise<boolean>;
    dispose(): Promise<void>;
  }

  interface ProxyRuntimeDependencies {
    applicationErrors: ProxyApplicationErrorLifecycle;
  }

  export interface ProxyHandle {
    ready: Promise<void>;
    closed: Promise<void>;
    stop(): Promise<void>;
  }

  function startProxyRuntime(
    dependencies: ProxyRuntimeDependencies,
  ): Promise<ProxyHandle>;
  ```

- [ ] Move top-level acquisition into `runtime.ts` without changing the production composition. `ProxyShutdownRequest` remains private to the signal/listener coordinator; `ProxyHandle.stop()` is a no-argument programmatic shutdown. Runtime/library code returns or rejects with shutdown state and never calls `exit()`. Only the `import.meta.main` wrapper translates terminal state to a process exit code; test that calling `stop()` cannot exit the host process.

- [ ] Keep the production entrypoint on its existing single reporter owner through a thin construction-site adapter; do not add selection, fallback, or dual invocation. Task 9 replaces this adapter with configured extension orchestration and exposes the final `StartProxyOptions`/`startProxy()` API.

- [ ] Add an injected application-error lifecycle acquisition slot after signal ownership and before renderer/router/listener acquisition. Register its one retryable cleanup with startup rollback. Task 9 supplies config-only extension orchestration to that slot.

- [ ] Split proxy shutdown into consumer and provider phases. `runProxyShutdownSteps()` invokes a nonthrowing `onFailure` callback immediately for each failed/timeout consumer step. A timeout retains the underlying settlement barrier; explicitly bounded-flush captured failures while ownership is retained, but do not teardown extensions, dispose signals, or start an overlapping retry until every consumer is aborted/quarantined and confirmed settled. After a fully settled consumer phase, capture failures while the reporter is live, let reporter teardown perform the sole flush/close, then dispose signal handlers.

- [ ] Unify programmatic, signal, and listener shutdown under `ProxyShutdownCoordinator`. A failed attempt remains single-flight until its consumer settlement barrier permits retry; only then may a later no-argument `ProxyHandle.stop()` start another attempt. Do not convert cleanup rejection into a permanent handled-success promise. Preserve the original trigger for logging without exposing `ProxyShutdownRequest` through the public handle.

- [ ] Add tests for lifecycle acquisition failure propagation, reporter availability through readiness, exactly one startup capture plus one provider-owned bounded flush during rollback before close, shutdown consumer failure capture, timed-out consumer ownership/late settlement, false flush, retryable provider teardown, signal-handler-last ordering, and unchanged legacy-main composition. Task 9 adds disabled/missing/config forwarding tests around the final extension composition.

- [ ] Ensure `runtime.ts`, shutdown, and rollback code contain no `initializeSentryFromEnv`, `shutdownSentry`, `SENTRY_*`, or Sentry import. The temporary construction-site adapter in `main.ts` remains the only legacy match and is deleted in Task 9.

- [ ] Run:

  ```bash
  set -euo pipefail
  deno test --frozen --allow-all src/proxy/runtime.test.ts src/proxy/main.test.ts src/proxy/startup-rollback.test.ts src/proxy/shutdown.test.ts src/proxy/shutdown-coordinator.test.ts
  deno check --frozen src/proxy/main.ts src/proxy/runtime.ts
  reporter_scan_status=0
  rg -n 'Sentry|SENTRY_|observability/sentry|ext-observability-sentry' src/proxy/runtime.ts src/proxy/startup-rollback.ts src/proxy/shutdown.ts || reporter_scan_status=$?
  case "$reporter_scan_status" in
    0) echo "Reporter implementation reference found in generic proxy lifecycle" >&2; exit 1 ;;
    1) ;;
    *) echo "Proxy reporter scan failed" >&2; exit "$reporter_scan_status" ;;
  esac
  ```

  The search must return no match. Separately record the one existing legacy construction-site adapter in `main.ts` for removal in Task 9.

- [ ] Commit and push the additive checkpoint after its focused tests and `git diff --check` pass:

  ```bash
  set -euo pipefail
  git add src/proxy/runtime.ts src/proxy/runtime.test.ts src/proxy/main.ts src/proxy/main.test.ts src/proxy/startup-rollback.ts src/proxy/startup-rollback.test.ts src/proxy/shutdown.ts src/proxy/shutdown.test.ts src/proxy/shutdown-coordinator.ts src/proxy/shutdown-coordinator.test.ts
  git commit -m "refactor: prepare generic proxy error lifecycle"
  git push origin codex/module-reconcile-20260723
  ```

## Task 8: Build the agent reporter lifecycle and listener hook

**Files:**

- Create: `src/agent/service/application-error-lifecycle.ts`
- Create: `src/agent/service/application-error-lifecycle.test.ts`
- Modify: `src/server/service-server.ts`
- Modify: `src/server/service-server.test.ts`
- Delete in Task 9: `src/agent/service/node-sentry.ts`
- Delete in Task 9: `src/agent/service/node-sentry.test.ts`

- [ ] Define these provider-neutral fields on an internal lifecycle options type. Task 9 adds them to `NodeVeryfrontCloudAgentServiceOptions` and feeds them to `orchestrateConfiguredExtensions`:

  ```ts
  extensions?: readonly ExtensionConfigEntry[];
  applicationErrors?: {
    enabled: boolean;
    flushTimeoutMs?: number;
  };
  ```

- [ ] Make the helper accept primed agent provider contracts so they enter the same loader-owned generation during Task 9; teardown must not erase unrelated manually owned registry entries.

- [ ] Implement a provider-neutral lifecycle that owns the log bridge and configured extension loader. Its retryable `stop()` order is: stop/detach agent consumers, unsubscribe the log bridge, capture accumulated cleanup failures, teardown extensions, and release registry ownership on success.

- [ ] Implement ordered lifecycle composition inside the new helper and test application-error cleanup as the final service lifecycle stage. Do not modify `runAgentServiceMain().finally()` or select the helper in production yet; Task 9 atomically attaches the helper to the returned runtime stop lifecycle and removes the legacy flush/reset.

- [ ] Add a typed synchronous `onStartupError(error): void` hook to `src/server/service-server.ts` and invoke it before runtime `stop()` on bind/readiness failure. The hook captures once; the ensuing reporter-extension teardown owns the sole bounded flush/close. Unsubscribe the application-error log bridge before logging that startup failure so the log path cannot deliver a duplicate event.

- [ ] Make listener closure a hard lifecycle barrier in `service-server.ts`. A rejected or timed-out listener close retains the runtime/provider stage and stops later lifecycle phases; `stop()` rejects with retryable state, retains the listener settlement promise, and permits a serialized retry only after that barrier settles or an explicit abort/quarantine confirmation succeeds. Do not call `runtime.stop()` while the HTTP listener can still deliver work. Add rejecting, never-settling, late-settling, and non-overlapping retry tests.

- [ ] Keep the optional service-server hook inert when omitted and leave the production agent composition unchanged. The new lifecycle is exercised through injected fake consumers/server handles only. Keep the legacy owner unchanged until Task 9; do not add a compatibility selector, fallback lifecycle, or dual invocation.

- [ ] Add tests proving the reporter remains active after listener readiness, captures runtime failures, stops only when `nodeServer.stop()` runs, propagates configured setup failure, produces exactly one capture plus one provider-owned teardown flush for bind failure, detaches the log bridge before startup-error logging, and retains ownership for teardown retry.

- [ ] Run:

  ```bash
  set -euo pipefail
  deno test --frozen --allow-all src/agent/service/application-error-lifecycle.test.ts src/server/service-server.test.ts
  deno check --frozen src/agent/service/application-error-lifecycle.ts src/server/service-server.ts
  reporter_scan_status=0
  rg -n 'Sentry|SENTRY_|node-sentry|observability/sentry|ext-observability-sentry' src/agent/service/application-error-lifecycle.ts src/server/service-server.ts || reporter_scan_status=$?
  case "$reporter_scan_status" in
    0) echo "Reporter implementation reference found in generic agent lifecycle" >&2; exit 1 ;;
    1) ;;
    *) echo "Agent reporter scan failed" >&2; exit "$reporter_scan_status" ;;
  esac
  ```

  The search must return no match. Separately record the existing legacy `node-sentry` paths that Task 9 deletes.

- [ ] Commit and push the additive checkpoint after its focused tests and `git diff --check` pass:

  ```bash
  set -euo pipefail
  git add src/agent/service/application-error-lifecycle.ts src/agent/service/application-error-lifecycle.test.ts src/server/service-server.ts src/server/service-server.test.ts
  git commit -m "refactor: prepare generic agent error lifecycle"
  git push origin codex/module-reconcile-20260723
  ```

## Task 9: Atomically switch every production owner and shipped artifact

**Files:**

- Modify: `src/observability/application-errors.ts`
- Modify: `src/observability/application-errors.test.ts`
- Modify: `src/observability/index.ts`
- Modify: `src/observability/index.test.ts`
- Delete: `src/observability/sentry.ts`
- Delete: `src/observability/sentry.test.ts`
- Modify: `src/server/bootstrap.ts`
- Modify: `src/server/bootstrap.test.ts`
- Modify: `src/server/production-server.ts`
- Modify: `src/server/production-server.test.ts`
- Modify: `src/server/dev-server/server.ts`
- Modify: `src/server/dev-server/server.test.ts`
- Modify: `src/server/dev-server/types.ts`
- Modify: `src/server/graceful-shutdown.ts`
- Modify: `src/server/graceful-shutdown.test.ts`
- Modify: `src/server/index.ts`
- Modify: `tests/integration/server/public-entrypoint.test.ts`
- Modify: `cli/shared/server-startup.ts`
- Modify: `cli/shared/server-startup.test.ts`
- Modify: `cli/commands/serve/command.ts`
- Modify: `cli/commands/serve/command.test.ts`
- Modify: `cli/commands/start/command.ts`
- Modify: `cli/commands/start/command.test.ts`
- Modify: `src/proxy/runtime.ts`
- Modify: `src/proxy/runtime.test.ts`
- Modify: `src/proxy/main.ts`
- Modify: `src/proxy/main.test.ts`
- Modify: `src/agent/service/node-runtime-infrastructure.ts`
- Modify: `src/agent/service/node-runtime-infrastructure.test.ts`
- Modify: `src/agent/hosted/cloud-agent-provider-bootstrap.ts`
- Modify: `src/agent/hosted/cloud-agent-config.ts`
- Modify: `src/agent/hosted/veryfront-cloud-agent-service.ts`
- Modify: `src/agent/hosted/veryfront-cloud-agent-service.test.ts`
- Modify: `src/agent/service/runtime.ts`
- Modify: `src/agent/service/runtime.test.ts`
- Modify: `src/agent/service/server.ts`
- Modify: `src/agent/service/server.test.ts`
- Delete: `src/agent/service/node-sentry.ts`
- Delete: `src/agent/service/node-sentry.test.ts`
- Modify: `src/server/services/rendering/ssr.service.test.ts`
- Delete: `extensions/ext-observability-sentry/`
- Modify: `deno.json`
- Regenerate: `deno.lock`
- Modify: `scripts/build/compile-binary.ts`
- Modify: `scripts/build/compile-binary.test.ts`
- Modify: `tests/unit/build/compile-binary-includes.test.ts`
- Regenerate: `src/extensions/builtin-extension-metadata.generated.ts`

- [ ] Atomically switch `src/observability/application-errors.ts` to the tested dispatcher from Task 2 and remove `setApplicationErrorReporter()`. The singleton resolves only the internal provenance-checked `tryResolveConfiguredVersioned(ApplicationErrorReporterName)` result for the coordinator's current configured owner/generation; it never accepts a public/manual, primed, raw-loader, built-in, legacy-discovery, stale-owner, or stale-generation entry. It uses a direct local diagnostic sink guarded against recursion and exports vendor-neutral `captureApplicationError`/`flushApplicationErrors` plus contract types through `veryfront/observability` (`src/observability/index.ts`).

- [ ] In this same commit, switch the production server/serve/start entrypoints to the Task 6 handlers, replace proxy side-effect dispatch with the Task 7 callable adapter, and attach the Task 8 lifecycle to the real agent service lifetime. Delete the superseded deferred Sentry loader, DSN parsing, package/source probing, global setter wiring, and legacy proxy/agent initialization. No production entrypoint may be left on the old path and no entrypoint may invoke both paths.

- [ ] Add and snapshot `extensions?: readonly ExtensionConfigEntry[]` plus generic `applicationErrors?: ApplicationErrorActivation` on production/dev/public server and agent options, forwarding full runtime config and every Task 3 orchestration input. For proxy, replace the temporary internal lifecycle dependency with the final API:

  ```ts
  export interface StartProxyOptions {
    readonly extensions?: readonly ExtensionConfigEntry[];
    readonly applicationErrors?: ApplicationErrorActivation;
  }

  export function startProxy(options: StartProxyOptions): Promise<ProxyHandle>;
  ```

  The public `createHandler()` composition root receives the same two generic fields and forwards them to production/dev runtime creation; it is not left as an undocumented bypass. The CLI loads project config through the existing first-party loader, calls `startProxy()` explicitly, awaits `ready` and `closed`, and never uses a side-effect dynamic import. Add public-entrypoint, static-consumer, and hostile-input forwarding tests for `startServer`, `createHandler`, proxy, and agent hosts.

- [ ] Adapt the real server consumers to Task 6's quiescence protocol, attach Task 8's lifecycle to the returned agent server handle, move manually registered agent contracts into loader priming, and remove the legacy `runAgentServiceMain().finally()` reporter cleanup. Failed or timed-out consumer cleanup retains extension ownership until an explicit close/abort barrier settles; a later stop is serialized and non-overlapping.

- [ ] Enforce the agent construction order: construct default/overridden providers without global registration; resolve and snapshot `cloud-agent-config`; create one runtime owner; prime those providers into its loader; activate configured extensions; resolve/initialize agent context; then start log/request/listener consumers. Remove the outer ad hoc registration cleanup so one ordered lifecycle owns stop/retry exactly once.

- [ ] Make graceful shutdown phase-aware. An outer deadline may race only the consumer-quiescence phase; it pins provider ownership and cannot leave a detached composite `stop()` promise that later advances into teardown. After diagnostic handoff, the same serialized owner either resumes provider teardown on confirmed settlement or retains it for retry. Test outer timeout followed by late consumer settlement and prove no concurrent capture/flush versus teardown.

- [ ] Capture the original post-setup error synchronously at each first-owning boundary—bootstrap finalization, `createHandler()`, production/dev readiness, proxy readiness, and agent listener startup—before invoking any cleanup that can dispose the provider. Outer catches receive an owned-error result and must not recapture wrappers. Reporter teardown remains the sole flush owner when cleanup can proceed; if an unsettled barrier retains ownership, perform one explicit bounded flush without starting teardown.

- [ ] Replace every setter-based test with an `ExtensionLoader`/registry-owned provider fixture, including `src/server/services/rendering/ssr.service.test.ts`. Add a consumer test for the public `veryfront/observability` surface. Through that public facade, prove an `AbortError` returns before contract resolution and never invokes the provider, while an ordinary failure still does.

- [ ] Add process-environment regression tests around every production composition root: `SENTRY_DSN` alone does not load or activate reporting, and `VERYFRONT_ERROR_REPORTER=sentry` is no longer read as a provider selector. Enabled reporting succeeds only with one explicitly configured extension object; enabled reporting without it fails startup.

- [ ] Add failing root metadata tests proving `veryfront/observability/sentry` is absent from root Deno exports/import aliases, `veryfront/observability` exposes the generic facade, and importing the removed subpath fails. Task 9 Phase B removes and verifies generated npm exports and static-consumer mappings before the combined checkpoint.

- [ ] Remove the core Sentry source/test, legacy combined extension, root export/import-map entry, and source candidates. Do not leave a deprecated wrapper. Remove the deleted combined extension from the workspace and regenerate/freeze `deno.lock`; Task 9 Phase B removes the generated/consumer mappings that depend on the new package build before anything is committed or pushed.

- [ ] Regenerate `src/extensions/builtin-extension-metadata.generated.ts` from workspace manifests after removing the combined package and run the generator's `--check` mode. The deleted package name/contracts must not survive in generated runtime metadata.

- [ ] In the same atomic source checkpoint, remove the deleted Sentry implementation from `createCompileArgs()`/`DEFAULT_INCLUDES` and invert its focused inclusion test. Assert that no include is equal to or nested beneath `extensions/ext-observability-sentry`, `extensions/ext-observability-sentry-node`, or `extensions/ext-observability-sentry-deno`; the two replacement provider packages are external composition, never core-binary inputs. Task 10 inventories every other non-core binary edge.

- [ ] Prove no old owner remains:

  ```bash
  set -euo pipefail
  legacy_owner_status=0
  rg -n -g '*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,json}' -g '!*.test.ts' -g '!*.integration.test.ts' 'setApplicationErrorReporter|observability/sentry|node-sentry|ext-observability-sentry(?:/|"|$)|@sentry/(?:node|deno)|@veryfront/ext-observability-sentry-(?:node|deno)' src cli deno.json scripts/build/compile-binary.ts || legacy_owner_status=$?
  case "$legacy_owner_status" in
    0) echo "Legacy application-error reporter owner remains" >&2; exit 1 ;;
    1) ;;
    *) echo "Legacy reporter-owner scan failed" >&2; exit "$legacy_owner_status" ;;
  esac
  reporter_activation_status=0
  rg -n -g '*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,json}' -g '!*.test.ts' -g '!*.integration.test.ts' -g '!cli/templates/**' 'initializeSentry|shutdownSentry|VERYFRONT_ERROR_REPORTER|SENTRY_(DSN|ENVIRONMENT|RELEASE|SERVICE_NAME)' src cli || reporter_activation_status=$?
  case "$reporter_activation_status" in
    0) echo "Reporter-specific activation or probing remains in core" >&2; exit 1 ;;
    1) ;;
    *) echo "Reporter activation scan failed" >&2; exit "$reporter_activation_status" ;;
  esac
  ```

- [ ] Run:

  ```bash
  set -euo pipefail
  deno install
  deno install --frozen
  deno run --config=scripts/test.deno.json --frozen --allow-read scripts/lint/audit-extension-dependency-ownership.ts
  deno run --config=scripts/test.deno.json --frozen --allow-read --allow-write scripts/build/generate-builtin-extension-metadata.ts
  deno run --config=scripts/test.deno.json --frozen --allow-read --allow-write scripts/build/generate-builtin-extension-metadata.ts --check
  deno test --config=scripts/test.deno.json --frozen --no-check --allow-all scripts/build/compile-binary.test.ts
  deno test --frozen --allow-all src/observability/application-errors.test.ts src/observability/index.test.ts src/server/application-error-runtime.test.ts src/server/bootstrap.test.ts src/server/production-server.test.ts src/server/dev-server/server.test.ts src/server/graceful-shutdown.test.ts cli/shared/application-error-handlers.test.ts cli/shared/server-startup.test.ts cli/commands/serve/command.test.ts cli/commands/start/command.test.ts src/proxy/runtime.test.ts src/proxy/main.test.ts src/proxy/startup-rollback.test.ts src/proxy/shutdown.test.ts src/proxy/shutdown-coordinator.test.ts src/agent/service/application-error-lifecycle.test.ts src/agent/service/node-runtime-infrastructure.test.ts src/agent/hosted/veryfront-cloud-agent-service.test.ts src/agent/service/runtime.test.ts src/agent/service/server.test.ts src/server/service-server.test.ts src/server/services/rendering/ssr.service.test.ts tests/unit/build/compile-binary-includes.test.ts
  deno task test:integration --filter 'Server Public Entrypoints'
  deno check --frozen src/server/index.ts src/proxy/main.ts src/agent/hosted/veryfront-cloud-agent-service.ts cli/main.ts
  deno task typecheck
  ```

- [ ] Run the strict source audit again and preserve its current non-Sentry findings as expected-red evidence for Task 10:

  ```bash
  set -euo pipefail
  strict_report_dir="$(mktemp -d)"
  trap 'rm -rf -- "${strict_report_dir:?}"' EXIT
  strict_status=0
  deno task lint:core-deps:strict --output "$strict_report_dir/post-reporter-source-dependencies.json" || strict_status=$?
  test "$strict_status" -eq 2
  deno eval 'const report = JSON.parse(await Deno.readTextFile(Deno.args[0])); const examined = report.examined; if (report.evidenceComplete !== true || report.operationalErrors?.length !== 0 || !Array.isArray(report.issues) || report.issues.length === 0 || !examined || !Number.isInteger(examined.roots) || examined.roots < 1 || !Number.isInteger(examined.files) || examined.files < 1) Deno.exit(1);' "$strict_report_dir/post-reporter-source-dependencies.json"
  ```

  This does not weaken the source checkpoint: all reporter-specific edges must be gone, while the branch remains merge/release-ineligible until the broader inventory is zero. Exit `3` is never accepted as dependency debt.

- [ ] Run `git diff --check`, but do **not** stage, commit, or push Phase A. This source-only tree is intentionally not an independently valid checkpoint: fresh npm generation and the broad consumer config still contain stale legacy paths. Continue immediately with Phase B in the same worktree and use one implementer/review cycle for the combined Task 9 diff.

  ```bash
  set -euo pipefail
  git diff --check
  ```

### Phase B: Harden npm and static-consumer artifacts before the atomic checkpoint

**Files:**

- Create: `scripts/build/audit-npm-artifacts.ts`
- Create: `scripts/build/audit-npm-artifacts.test.ts`
- Modify: `scripts/build/npm-package-metadata.ts`
- Modify: `scripts/build/npm-package-metadata.test.ts`
- Modify: `scripts/build/build-npm-dnt.ts`
- Modify: `scripts/build/build-npm-extension-packages.ts`
- Modify: `scripts/build/npm-extension-package-metadata.test.ts`
- Modify: `scripts/typecheck/tsconfig.consumer.json`
- Create: `scripts/typecheck/tsconfig.reporter-consumer.json`
- Modify: `scripts/test-config-lock.test.ts`
- Delete: `scripts/typecheck/fixtures/sentry-extension.ts`
- Create: `scripts/typecheck/fixtures/sentry-node-extension.ts`
- Create: `scripts/typecheck/fixtures/sentry-deno-extension.ts`
- Modify: `scripts/test/npm-install-smoke.sh`
- Modify: `deno.json`
- Modify: `.github/workflows/cicd.yml`
- Regenerate: `docs/api-reference/veryfront/observability.md`
- Regenerate: `docs/api-reference/veryfront/extensions.md`
- Regenerate: `docs/api-reference/veryfront/index.md`
- Regenerate: `docs/api-reference/veryfront/agent.md`
- Regenerate: `docs/api-reference/veryfront/server.md`

- [ ] First add failing artifact tests proving the generated root package has no `veryfront/observability/sentry` export, no Sentry SDK or reporter-extension implementation in production dependency fields, JavaScript, declarations, declaration maps, source maps, or packlist, and one vendor-neutral `veryfront/observability` surface. Keep the scan syntax-aware enough not to reject unrelated Sentry integration-template text.

- [ ] Implement `audit-npm-artifacts.ts` against a freshly generated `npm/` tree. Reject absent/zero examined outputs as well as forbidden matches. Require an explicit policy; absence or an unknown policy is operational failure. Phase B implements `reporter-enforce`, which fails only the reporter boundary while still failing closed on incomplete evidence. Its tests prove a non-Sentry vendor fixture does not falsely fail this slice, a Sentry/provider path does fail it, and incomplete evidence is operational failure. Task 10 adds the separate generic policies. The normal npm build remains on `reporter-enforce` until the later zero-inventory gate promotion.

- [ ] In `npm-package-metadata.ts`, expose a pure root npm export-policy function derived from source `deno.json` plus explicit first-party dnt export rules. Tests compare the complete expected export/entrypoint set before emission; generated npm `package.json` is never an expectation source.

- [ ] Add a pure `createRootNpmDenoConfigProjection()` beside that export policy. It emits only `version`, the exact first-party root export policy, and the `veryfront`/`#veryfront` import mappings whose normalized targets are local production modules present in the root dnt output. It rejects non-plain input, path escape, extension implementation targets, and non-first-party specifiers; it never copies `workspace`, `tasks`, `exclude`, compiler/build/test settings, dependency-age data, or unrelated import-map entries. After dnt emission, deterministically replace `npm/esm/deno.js` with this projection rather than patching strings in dnt's full-config output. Tests exercise the real `resolveVeryfrontModuleTarget`/version consumers against the projected module, assert no required first-party runtime mapping was lost, and prove workspace/provider/vendor paths cannot survive in the shipped bytes. The artifact auditor treats any reporter provider path in this config module as a violation even when it appears only in inert object data.

- [ ] Add `scripts/build/audit-npm-artifacts.test.ts` to `test:scripts` in the same change and run the script-test registration regression before treating the audit as evidence.

- [ ] Extend the extension package scanner beyond emitted JavaScript. Node package JavaScript and dependency fields may own only the declared `@sentry/node` closure; Deno may own only the declared `@sentry/deno` closure. Public declarations and maps may expose neither SDK type, and no emitted path may escape into repository source or the sibling provider.

- [ ] Remove the combined paths/fixture from the existing broad consumer config but preserve its current `skipLibCheck` policy; unrelated declaration debt must not be disguised as part of this cutover. Explicitly exclude `fixtures/sentry-node-extension.ts` and `fixtures/sentry-deno-extension.ts` from that broad config so wildcard includes cannot run them under `skipLibCheck: true`. Add `tsconfig.reporter-consumer.json` with `skipLibCheck: false`, include only those two fixtures, resolve their public built declarations plus `veryfront/extensions`/`veryfront/observability`, and provide no direct SDK path mapping. Add `typecheck:consumer:reporter` as a direct no-build `tsc --noEmit` task and run it only after an audited npm build. Config tests prove the fixture sets are disjoint and exhaustive.

- [ ] Extend `scripts/test/npm-install-smoke.sh` so it creates its own temporary pack directory and obtains tarball paths from `npm pack --json --pack-destination`. Derive the root package's complete co-published first-party dependency closure from generated manifests and pack every member exactly once. For each root-only, root-plus-Node-provider, and root-plus-Deno-provider room, generate `package.json` with every required first-party package as an exact absolute `file:` tarball dependency and a root `overrides` entry referencing that same direct dependency (`"$<package-name>"` syntax), then run `npm install --ignore-scripts --install-strategy=nested --strict-peer-deps`. This forces nested transitive first-party resolutions to the audited local tarballs rather than merely installing duplicate top-level copies. Assert every `veryfront`/`@veryfront/*` lock entry resolves to an expected local tarball, exercise public imports, require an empty `npm ls --all --json` problems array, and prove each room excludes the sibling provider/SDK. The root-only room contains neither reporter provider nor SDK. Cleanup every temporary directory through the existing trap.

- [ ] Make `build-npm-dnt.ts` invoke `audit-npm-artifacts.ts --policy reporter-enforce` after both root and extension emission succeed. A later `typecheck:consumer` rebuild must therefore produce audited output rather than replacing audited bytes with unchecked bytes. The build fails on an absent auditor, zero examined artifacts, operational failure, or any reporter boundary issue, but it does not become generically strict while Task 10's broader inventory is knowingly nonempty.

- [ ] Persist the strict reporter declaration gate. Add `typecheck:consumer:reporter` immediately after `typecheck:consumer` in the full `verify` task and in the `tests-npm-install-smoke` CI job; the broad task's audited rebuild must complete first. Extend `scripts/test-config-lock.test.ts` with an ordering contract for both locations and prove removing, reordering, or running the strict fixture under the broad config fails. Release jobs remain transitively blocked by this required CI job; do not add a second unchecked build between the reporter typecheck and clean-room install smoke.

- [ ] Run:

  ```bash
  set -euo pipefail
  deno test --config=scripts/test.deno.json --frozen --no-check --allow-read --allow-write --allow-run scripts/build/audit-npm-artifacts.test.ts scripts/build/npm-package-metadata.test.ts scripts/build/npm-extension-package-metadata.test.ts scripts/test-config-lock.test.ts
  deno task test:scripts
  deno task build:npm
  deno run --config=scripts/test.deno.json --frozen --allow-read --allow-run=npm scripts/build/audit-npm-artifacts.ts --policy reporter-enforce
  deno task typecheck:consumer
  deno task typecheck:consumer:reporter
  bash scripts/test/npm-install-smoke.sh
  deno task docs
  deno task docs:generated:check
  deno task docs:validate
  deno task verify:quick
  git diff --check
  ```

- [ ] Commit only repository-tracked metadata and code; never commit temporary tarballs, npm lockfiles from smoke rooms, or `node_modules`. Stage the exact Phase A and Phase B union, inspect the combined staged diff, create one atomic commit, and only then push:

  ```bash
  set -euo pipefail
  git add -A -- src/observability/application-errors.ts src/observability/application-errors.test.ts src/observability/index.ts src/observability/index.test.ts src/observability/sentry.ts src/observability/sentry.test.ts src/server/bootstrap.ts src/server/bootstrap.test.ts src/server/production-server.ts src/server/production-server.test.ts src/server/dev-server/server.ts src/server/dev-server/server.test.ts src/server/dev-server/types.ts src/server/graceful-shutdown.ts src/server/graceful-shutdown.test.ts src/server/index.ts src/server/services/rendering/ssr.service.test.ts tests/integration/server/public-entrypoint.test.ts cli/shared/server-startup.ts cli/shared/server-startup.test.ts cli/commands/serve/command.ts cli/commands/serve/command.test.ts cli/commands/start/command.ts cli/commands/start/command.test.ts src/proxy/runtime.ts src/proxy/runtime.test.ts src/proxy/main.ts src/proxy/main.test.ts src/agent/service/node-runtime-infrastructure.ts src/agent/service/node-runtime-infrastructure.test.ts src/agent/hosted/cloud-agent-provider-bootstrap.ts src/agent/hosted/cloud-agent-config.ts src/agent/hosted/veryfront-cloud-agent-service.ts src/agent/hosted/veryfront-cloud-agent-service.test.ts src/agent/service/runtime.ts src/agent/service/runtime.test.ts src/agent/service/server.ts src/agent/service/server.test.ts src/agent/service/node-sentry.ts src/agent/service/node-sentry.test.ts extensions/ext-observability-sentry deno.json deno.lock scripts/build/compile-binary.ts scripts/build/compile-binary.test.ts tests/unit/build/compile-binary-includes.test.ts src/extensions/builtin-extension-metadata.generated.ts
  git add -A -- scripts/build/audit-npm-artifacts.ts scripts/build/audit-npm-artifacts.test.ts scripts/build/npm-package-metadata.ts scripts/build/npm-package-metadata.test.ts scripts/build/build-npm-dnt.ts scripts/build/build-npm-extension-packages.ts scripts/build/npm-extension-package-metadata.test.ts scripts/typecheck/tsconfig.consumer.json scripts/typecheck/tsconfig.reporter-consumer.json scripts/typecheck/fixtures/sentry-extension.ts scripts/typecheck/fixtures/sentry-node-extension.ts scripts/typecheck/fixtures/sentry-deno-extension.ts scripts/test/npm-install-smoke.sh scripts/test-config-lock.test.ts deno.json .github/workflows/cicd.yml docs/api-reference/veryfront/observability.md docs/api-reference/veryfront/extensions.md docs/api-reference/veryfront/index.md docs/api-reference/veryfront/agent.md docs/api-reference/veryfront/server.md
  test -z "$(git diff --name-only)"
  test -z "$(git ls-files --others --exclude-standard)"
  git diff --cached --check
  git commit -m "refactor: isolate application error reporting"
  git push origin codex/module-reconcile-20260723
  ```

## Task 10: Build generic dependency evidence and freeze the exact extraction backlog

**Files:**

- Modify: `scripts/build/compile-binary.ts`
- Modify: `scripts/build/compile-binary.test.ts`
- Create: `scripts/build/compile-input-manifest.ts`
- Create: `scripts/build/compile-input-manifest.test.ts`
- Modify: `scripts/build/prepare-framework-sources.ts`
- Modify: `tests/unit/build/compile-binary-includes.test.ts`
- Create: `scripts/build/audit-binary-module-graph.ts`
- Create: `scripts/build/audit-binary-module-graph.test.ts`
- Create: `scripts/build/audit-browser-artifacts.ts`
- Create: `scripts/build/audit-browser-artifacts.test.ts`
- Modify: `scripts/build/audit-npm-artifacts.ts`
- Modify: `scripts/build/audit-npm-artifacts.test.ts`
- Create: `scripts/lint/core-dependency-inventory.ts`
- Create: `scripts/lint/core-dependency-inventory.test.ts`
- Create: `scripts/build/core-artifact-registry.ts`
- Create: `scripts/build/core-artifact-registry.test.ts`
- Create: `scripts/build/prepare-core-dependency-evidence.ts`
- Create: `scripts/build/prepare-core-dependency-evidence.test.ts`
- Create: `scripts/build/binary-targets.ts`
- Create: `scripts/build/binary-targets.test.ts`
- Modify: `scripts/build/build-npm-dnt.ts`
- Modify: `scripts/build/generate-dev-ui-manifest.ts`
- Create: `scripts/build/generate-dev-ui-manifest.test.ts`
- Create: `.github/dependency-free-core-inventory.json`
- Create: `.github/DEPENDENCY-FREE-CORE.md`
- Modify: `scripts/build/prebundle-client-scripts.ts`
- Modify: `scripts/build/prebundle-rsc-scripts.ts`
- Modify: `scripts/build/prebundle-bridge.ts`
- Modify: `src/build/production-build/client-runtime.ts`
- Regenerate: `src/build/production-build/templates.ts`
- Regenerate: `src/server/handlers/dev/framework-candidates.generated.ts`
- Regenerate: `src/studio/bridge/bridge-bundle.generated.ts`
- Regenerate: `src/rendering/rsc/rsc-bundles.generated.ts`
- Regenerate: `src/server/dev-ui/manifest.json`
- Modify: `tests/e2e/setup/binary.ts`
- Modify: `tests/integration/compiled-binary-e2e.test.ts`
- Modify: `deno.json`

- [ ] Add failing inventory fixtures proving that every `DEFAULT_INCLUDES` entry under `extensions/**`, every external SDK/package payload, and every third-party module reachable from the compiled CLI is a core violation. Do not force the existing broad inclusion test green by deleting unknown implementations in this task; the generated inventory identifies their owners for exact follow-up plans. The reporter-specific Sentry include was already removed in Task 9 Phase A.

- [ ] Ensure prepared framework sources cannot copy the deleted `src/observability/sentry.ts`, `src/agent/service/node-sentry.ts`, or either new reporter extension implementation. More generally, classify every blanket-copied `extensions/**` implementation as an inventory issue rather than adding a permitted-built-in exception.

- [ ] Add a generic graph gate using `deno info --json --frozen cli/main.ts`. Inspect `.modules` specifiers and edges, not `.npmPackages`. Reject every `npm:`, `jsr:`, HTTP(S), bare vendor, and extension-implementation node reachable from the core CLI entry; target-valid runtime built-ins and resolved local first-party core modules are the only accepted classes. Report Sentry paths/SDKs as named diagnostics, not as the boundary's only rejection cases.

- [ ] Import Task 1's target/builtin classifier rather than defining another exemption table. Browser artifacts allow no module builtins; root npm/Node and Deno CLI/binary may import only names in the canonical `node:` builtin set plus local first-party files; `deno:`, `ext:`, and fake `node:` names fail everywhere. A universal root uses the browser/Node/Deno intersection, so `node:fs` fails. Add table tests for every target and scheme.

- [ ] Define `CompileInputManifestV1` from the exact `createCompileArgs()` result because Deno 2.7.7 exposes no physical compiled-VFS listing. Record the CLI entrypoint, target, every compile flag, every module-type `--include`, recursive file/directory include members, normalized source-relative IDs, SHA-256 hashes, and a recursively generated frozen `deno info` graph for the entrypoint and each included module. Generate compile arguments only from this manifest, bind its hash plus final binary SHA-256 in a sidecar, and reject extra/missing/path-escaping inputs. A post-build forbidden-string scan is supplemental, not a substitute for the manifest. Do not claim physical VFS inspection unless a separately selected/pinned eszip parser is added with format-version tests.

- [ ] Make each browser prebundler emit deterministic dependency evidence from the exact successful build result: sorted entrypoint, input, external, and output paths plus SHA-256 of the emitted bundle. Extend `generate-dev-ui-manifest.ts` with the same evidence contract and parse every embedded TS/TSX module in `src/server/dev-ui/manifest.json` under browser policy; this shipped/served source artifact is a browser root, not an inert JSON exception. `audit-browser-artifacts.ts` verifies all hashes and scans generated JavaScript/source maps/embedded modules as well as metafile-derived graphs. Add stale-input, missing-embedded-module, and third-party-dev-UI-import tests.

- [ ] Give npm, browser, prepared-source, and binary producers a versioned evidence header containing producer/tool version, target, canonical entrypoint or include manifest, sorted input digests, and output digest. Auditors recompute all referenced hashes and reject absent evidence, missing outputs, extra untracked outputs, changed inputs, or a producer version mismatch. File timestamps are not freshness evidence. `deno info` graphs are generated inside the audit invocation from the current frozen lock/config.

- [ ] Define the authoritative expected set in `core-artifact-registry.ts` by importing Task 1's source-context registry, deriving expected npm roots from source `deno.json` plus Task 9 Phase B's explicit dnt export policy, registering client/RSC/studio plus dev-UI browser roots, and importing `binary-targets.ts`. Generated and packed npm manifests are observed evidence only, never expectation sources. `binary-targets.ts` declares target, filename, and optionality once. Until deferred release cleanup removes `build-all.js`, a source-contract test requires exact equality with both its target list and CI's matrix/optionality. Tests require one evidence record per declared target and exact equality; deleting an emitted npm export while source policy remains unchanged is incomplete evidence/exit `3`, and removing or renaming any source root, browser root, or binary target also fails.

- [ ] Implement `prepare-core-dependency-evidence.ts --output-dir <new-empty-directory>`. It rejects an existing or nonempty output directory, invokes npm/browser/binary producers with explicit output paths under that directory, records exact source/config/lock/tool input hashes before building, then calls auditor library functions in collection/integrity mode. Known policy issues are preserved as structured issues and do not make preparation fail; only missing/incomplete/stale/drifted evidence, producer failure, malformed output, or unknown ownership is operational failure. Unit tests prove a known third-party edge survives preparation into the inventory input, use injected runners and two temporary roots, require deterministic generation before artifact consumers, assert every Deno child uses the isolated script config plus `--frozen`, and never delete a caller-provided directory.

- [ ] Add `--output-dir <new-empty-directory>` to `build-npm-dnt.ts`. It writes only under the canonical destination, emits versioned producer evidence, and rejects existing/nonempty destinations, path escape, unexpected outputs, or fallback to repository `npm/`. The orchestrator always passes its isolated npm output path; a regression spies on exact arguments and proves repository `npm/` remains untouched.

- [ ] Generate every browser artifact into the evidence directory first, then require byte equality with each tracked generated module/manifest consumed by npm or binary builds before those consumers run. Record downstream consumer IDs in evidence. A regression mutates tracked `templates.ts`, bridge/RSC bundle modules, framework candidates, and dev-UI manifest one at a time and proves preparation fails stale rather than auditing unrelated temporary bytes.

- [ ] Extend Task 9 Phase B's npm artifact audit with a typed internal `generic-collect` API and separate `generic-strict` CLI policy; do not broaden `reporter-enforce`. Run `npm pack --json --pack-destination <auditor-temp-directory>` against the isolated root npm output, safely extract the exact tarball, and require extracted paths to equal the recorded packlist/output inventory. Inspect the extracted production manifest, every conditional runtime/declaration export, JavaScript, declarations, declaration maps, source maps, bins, `esm/deno.js`, and internal files. Package-local first-party modules and target-valid `node:` builtins are allowed; every vendor/JSR/HTTP/extension implementation edge is returned by generic collection and rejected by generic strict. Extension package outputs remain a separate target class and may own only their declared external implementation closure. `prepare-core-dependency-evidence.ts` calls the typed collection API and preserves issues for inventory; collection has no gate-success boolean, and only the strict adapter maps a complete nonempty result to exit `2`. Tests feed the same non-Sentry vendor fixture through all policies: reporter enforcement exits `0`, generic collection returns the issue, and generic strict exits `2`; incomplete evidence exits `3` under both CLI policies and cannot produce a collection result. Normal `build:npm` remains reporter-strict/green while the same bytes produce expected-red generic evidence.

- [ ] Change binary E2E cache inputs from the compile-input manifest and eligible core sources only. Run a freshly copied core binary from a temporary directory outside the repository to prove no workspace fallback. Provider-dependent E2E cases install exact audited extension packages into that temporary project and compose them explicitly; they never rely on an embedded extension. Keep core-only E2E cases provider-free.

- [ ] Give each strict audit a shared structured issue schema and pure collection function. CLI exit codes are exact: `0` means complete evidence with zero policy issues; `2` means complete evidence with one or more policy issues; `3` means incomplete evidence or an operational/parse/traversal/ownership error. `core-dependency-inventory.ts` writes `.github/dependency-free-core-inventory.json` even for exit `2` and regenerates `.github/DEPENDENCY-FREE-CORE.md`. Its JSON contains `evidenceComplete`, `operationalErrors`, `issues`, input/evidence hashes, and `examined: { roots, files, artifacts }`; the Markdown states that both files are diagnostic reports, never allowlists. A zero examined count, malformed evidence, or unowned/multiply owned issue is exit `3`, never an expected-red policy result. Tests cover every exit code, partial/missing evidence, producer crash, duplicate roots, deterministic sorting/owner-plan slugs, and report creation before exit `2`.

- [ ] Canonicalize all evidence IDs: repository files use `file:<root-relative-posix-path>`, npm components use canonical purls plus resolved version, URLs are normalized without credentials, and no absolute worktree/temp path may survive. Reject symlink/path escape. Generate equivalent fixtures under two different temporary roots and assert byte-identical evidence.

- [ ] Inventory validation compares the orchestrator result to the authoritative registry with exact equality; nonempty is insufficient. Optional release targets are not silently skipped, and a platform policy must be represented as a first-party target declaration rather than inferred from the current host.

- [ ] Register every Task 10 script test in `test:scripts` and run the script-test registration regression. Keep the strict inventory as an explicit expected-red evidence task in this phase; do not wire it into aggregate CI while known non-Sentry violations remain.

- [ ] Run the focused tool tests, build fresh evidence, and execute the inventory command. Before extraction, a nonzero inventory exit is expected and must be preserved as evidence:

  ```bash
  set -euo pipefail
  deno test --config=scripts/test.deno.json --frozen --no-check --allow-read --allow-write --allow-run scripts/build/compile-binary.test.ts scripts/build/compile-input-manifest.test.ts scripts/build/audit-binary-module-graph.test.ts scripts/build/audit-browser-artifacts.test.ts scripts/build/audit-npm-artifacts.test.ts scripts/build/core-artifact-registry.test.ts scripts/build/binary-targets.test.ts scripts/build/generate-dev-ui-manifest.test.ts scripts/build/prepare-core-dependency-evidence.test.ts scripts/lint/core-dependency-inventory.test.ts scripts/test-config-lock.test.ts
  deno test --frozen --allow-all tests/unit/build/compile-binary-includes.test.ts
  deno task generate
  deno task generate:manifests:check
  core_evidence_dir="$(mktemp -d)"
  trap 'rm -rf -- "${core_evidence_dir:?}"' EXIT
  deno run --config=scripts/test.deno.json --frozen -A scripts/build/prepare-core-dependency-evidence.ts --output-dir "$core_evidence_dir/evidence"
  inventory_status=0
  deno run --config=scripts/test.deno.json --frozen --allow-read --allow-write --allow-run scripts/lint/core-dependency-inventory.ts --evidence-dir "$core_evidence_dir/evidence" --output .github/dependency-free-core-inventory.json --owner-table .github/DEPENDENCY-FREE-CORE.md || inventory_status=$?
  test "$inventory_status" -eq 2
  deno eval 'const report = JSON.parse(await Deno.readTextFile(Deno.args[0])); const examined = report.examined; if (report.evidenceComplete !== true || report.operationalErrors?.length !== 0 || !Array.isArray(report.issues) || report.issues.length === 0 || !examined || !Number.isInteger(examined.roots) || examined.roots < 1 || !Number.isInteger(examined.files) || examined.files < 1 || !Number.isInteger(examined.artifacts) || examined.artifacts < 1 || report.issues.some((issue) => typeof issue.owner !== "string" || issue.owner.length === 0)) Deno.exit(1);' .github/dependency-free-core-inventory.json
  deno task verify:quick
  ```

  The inventory invocation must exit exactly `2`, while the validating `deno eval` exits zero. The temporary evidence directory is retained through validation and then removed by the guarded `EXIT` trap; it is never committed.

- [ ] Treat every broader non-Sentry edge—AJV, esbuild, Redis, Zod, JSR, esm.sh, Tailwind bundles, indirect runtime loaders, and anything else reported—as a hard failure. The inventory is diagnostic evidence, not a baseline; it is overwritten on each run and never consumed as an exception list.

- [ ] Convert the nonempty inventory into a deterministic owner table containing issue ID, source/artifact root, importing file or manifest field, resolved external component, owning top-level module, and target class. Every issue must map to exactly one owner group; unknown or multiply owned issues make this task fail rather than being put in a catch-all bucket.

- [ ] For each owner group, create a separate design and implementation-plan filename in the owner table. The plan itself is written only after the evidence identifies exact files and interfaces; do not put an aspirational "extract the rest" task in this reporter plan. Required remedy is always an explicit first-party contract plus separately packaged extension/application composition, or deletion when the capability is dead. No baseline, warning downgrade, identifier/path exception, or allowlist is permitted.

- [ ] Commit and push the green evidence tooling plus the exact expected-red inventory/owner-table metadata. Do not rename the strict gate or alter release/CI promotion in this checkpoint:

  ```bash
  set -euo pipefail
  git add scripts/lint/core-dependency-inventory.ts scripts/lint/core-dependency-inventory.test.ts scripts/build/core-artifact-registry.ts scripts/build/core-artifact-registry.test.ts scripts/build/prepare-core-dependency-evidence.ts scripts/build/prepare-core-dependency-evidence.test.ts scripts/build/binary-targets.ts scripts/build/binary-targets.test.ts scripts/build/build-npm-dnt.ts scripts/build/generate-dev-ui-manifest.ts scripts/build/generate-dev-ui-manifest.test.ts scripts/build/compile-binary.ts scripts/build/compile-binary.test.ts scripts/build/compile-input-manifest.ts scripts/build/compile-input-manifest.test.ts scripts/build/prepare-framework-sources.ts scripts/build/audit-binary-module-graph.ts scripts/build/audit-binary-module-graph.test.ts scripts/build/audit-browser-artifacts.ts scripts/build/audit-browser-artifacts.test.ts scripts/build/audit-npm-artifacts.ts scripts/build/audit-npm-artifacts.test.ts scripts/build/prebundle-client-scripts.ts scripts/build/prebundle-rsc-scripts.ts scripts/build/prebundle-bridge.ts src/build/production-build/client-runtime.ts src/build/production-build/templates.ts src/server/handlers/dev/framework-candidates.generated.ts src/server/dev-ui/manifest.json src/studio/bridge/bridge-bundle.generated.ts src/rendering/rsc/rsc-bundles.generated.ts tests/unit/build/compile-binary-includes.test.ts tests/e2e/setup/binary.ts tests/integration/compiled-binary-e2e.test.ts .github/dependency-free-core-inventory.json .github/DEPENDENCY-FREE-CORE.md deno.json
  git commit -m "build: inventory external core dependencies"
  git push origin codex/module-reconcile-20260723
  ```

### Mandatory phase boundary after Task 10

Task 10 completes the reporter plan's evidence deliverable; it does **not** complete the dependency-free-core program. If the inventory is nonempty, stop executable work in this plan after Task 11 documentation. Immediately write and execute one exact owner-specific extraction plan per inventory group. The branch remains merge- and release-ineligible, no module ledger entry advances to production-grade, and the legacy aggregate gate remains unchanged until all source/npm/browser/binary inventories reach zero.

The final one-way promotion is intentionally outside this plan because its exact file/API changes depend on Task 10 evidence. The later promotion plan must delete the legacy audit, rename the strict implementation to canonical `lint:core-deps`, make `verify:quick` enforce source boundaries, make full `verify`/CI/pre-publish build fresh isolated evidence before artifact audits, add ordering/completeness contract tests, and demonstrate every canonical gate green. It must then define the release-artifact/SBOM/publication changes from the actual zero-edge artifact set.

## Deferred release-artifact acceptance requirements (not an executable task)

Do not implement or schedule this section from the reporter plan. After every owner-specific extraction is complete and the canonical source, npm, binary, and browser gates are green, rewrite these requirements as a separate exact implementation plan against the then-current artifact set. Release evidence must never bless a knowingly noncompliant core artifact.

**Candidate future scope (must be revalidated after zero-edge inventory):**

- Create: `scripts/build/artifact-inventory.ts`
- Create: `scripts/build/artifact-inventory.test.ts`
- Create: `scripts/build/prepare-release-artifacts.ts`
- Create: `scripts/build/prepare-release-artifacts.test.ts`
- Modify: `scripts/build/compile-binary.ts`
- Modify: `scripts/build/compile-binary.test.ts`
- Modify: `scripts/build/generate-sbom.ts`
- Modify: `scripts/build/generate-sbom.test.ts`
- Modify: `scripts/lint/audit-dependency-boundaries.ts`
- Modify: `scripts/lint/audit-dependency-boundaries.test.ts`
- Modify: `scripts/security/submit-dependency-snapshot.ts`
- Modify: `scripts/security/submit-dependency-snapshot.test.ts`
- Modify: `scripts/ci/publish-npm-packages.sh`
- Modify: `scripts/ci/publish-npm-packages.test.ts`
- Modify: `.github/workflows/cicd.yml`
- Modify: `.github/workflows/security-audit.yml`
- Modify: `deno.json`

- Define and test a deterministic inventory schema; arrays and graph nodes/edges are lexically sorted and there is no wall-clock field:

  ```ts
  export interface ReleaseArtifactInventoryV1 {
    schemaVersion: 1;
    releaseVersion: string;
    artifacts: Array<{
      id: string;
      kind: "root-npm" | "extension-npm" | "browser" | "binary";
      path: string;
      sha256: string;
      sha512: string;
      dependencyGraph: { path: string; sha256: string };
      sbom: { path: string; sha256: string };
    }>;
  }

  export interface ArtifactDependencyGraphV1 {
    schemaVersion: 1;
    root: string;
    target: "node-package" | "deno-binary" | "browser" | "extension-package";
    artifactSha256: string;
    nodes: Array<{
      id: string;
      kind: "first-party" | "runtime-builtin" | "npm" | "jsr" | "http" | "extension";
      version?: string;
      integrity?: string;
      resolvedLocator?: string;
    }>;
    edges: Array<{
      from: string;
      to: string;
      direct: boolean;
      relationship:
        | "import"
        | "dependency"
        | "optionalDependency"
        | "peerDependency"
        | "bundledDependency";
      requested?: string;
      exportCondition?: string;
      resolvedVersion?: string;
      integrity?: string;
      optionalPeer?: boolean;
    }>;
  }
  ```

- Add tests demonstrating the current manifest-only `core.json=0` claim is rejected when the resolved CLI graph contains a third-party module, when artifact bytes do not match `artifactSha256`, or when the graph/SBOM bytes do not match their inventory hashes. Replacing an evidence file without replacing and re-hashing the artifact set must fail.

- Implement `prepare-release-artifacts.ts --version <exact-version> --source-date-epoch <seconds> --output-dir <new-empty-directory>`. Validate the requested stable/RC semver and epoch and use those values for every artifact. Add an explicit validated release-version input to binary compilation so compiled `veryfront --version` output and embedded metadata match the inventory even for generated RC versions; do not derive release binary identity from a stale checkout version. Build each npm/browser/binary artifact once, copy each built npm package into an isolated staging directory, and materialize the release version plus all first-party dependency/peer/optional ranges there before packing. Never mutate repository source or build output during publication. Pack the root and every publishable extension exactly once, consume the final browser/binary graphs, hash the exact tarballs/bundles/binaries with SHA-256 and SHA-512, and write `artifact-inventory.json`. Tests inject command execution and hashing so invalid version/epoch, conflicting embedded version, failed build/pack, duplicate IDs, path escape, hash drift, and zero-artifact input all fail closed.

- Extract each exact npm tarball after packing and validate its `package/package.json`: name, requested version, first-party ranges, every conditional export and `bin` root, `main`/`module`/`types`, dependency fields, files, and absence of repository-relative paths must match policy. Build its dependency graph from those extracted bytes and a fresh temporary `npm install --ignore-scripts --install-strategy=nested --omit=dev`; install each provider with the exact co-release root tarball and forbid registry resolution for every first-party name. Hash the generated lockfile, reject a nonempty npm `problems` array, and inspect every public runtime/declaration root plus every production dependency field, including declarations for uninstalled peers. Preserve relationship kind, requested range/specifier, export condition, resolved locator/version, integrity, directness, and optional-peer status; missing resolution/integrity for an installed external node fails closed.

- Preserve per-manifest SBOMs under a separate `sbom:manifests` command and label them `manifest-ownership`. Generate artifact SBOMs only through `sbom:artifacts --inventory <path>` after verifying each graph digest against artifact bytes. Bind artifact digests into SBOM components, hash final graph/SBOM bytes into the inventory, then perform one full cross-hash verification pass. Require explicit `--source-date-epoch <non-negative-safe-integer-seconds>`, derive it once from the source commit in CI, and never read an ambient `SOURCE_DATE_EPOCH` or wall clock.

- Expand reachable npm roots through lock relationships, retain direct/transitive relationships in `dependencies-by-manifest.json`, include JSR/HTTP modules in graph inventories, and make UUID/timestamp inputs deterministic for reproducible artifacts.

- Add generic acceptance assertions using the final target policy: root npm permits only first-party nodes and `node:` builtins, browser permits only first-party nodes and no module builtins, and the Deno binary permits only first-party plus Deno/`node:` builtins. Any npm/jsr/http/extension node fails a core gate. Separately assert each extension owns only its declared external implementation closure. Provider-specific diagnostics supplement, but never weaken, the generic boundary.

- Change `publish-npm-packages.sh` to accept the audited `artifact-inventory.json`. It must preflight every package name/version before the first irreversible action, publish dependency-topologically, require `VERSION` to equal `inventory.releaseVersion`, re-hash each tarball/graph/SBOM, validate packed manifests again, and invoke `npm publish` on exact `.tgz` paths rather than mutable package directories. A resumed release may accept an existing version only after downloading it and proving npm `dist.integrity` and bytes equal the inventoried SHA-512. Remove every publish-time manifest mutation. Run exact SPDX/package-license/NOTICE/component-license validation before publication and attach the inventory, graphs, and per-binary SBOMs to releases.

- Register every new release script test in `test:scripts` and run the script-test registration regression before treating CI coverage as complete.

- Define and test the exact workflow order: compute one version and commit epoch before any build; build/hash once; cross-verify inventory/graphs/SBOMs/licenses; preflight every package; publish exact tarballs; attach only inventoried release assets; let CI alone create the stable tag. RC and stable binaries must report the inventory version. Homebrew must verify and consume inventoried hashes rather than bless newly downloaded bytes.

- The future plan must provide its own exact tests, commands, workflow fixtures, and focused commits after revalidating the candidate paths above. None of these acceptance requirements authorizes publishing, tagging, or changing release infrastructure during this reporter phase.

## Task 11: Publish reporter migration guidance and record the phase boundary

**Files:**

- Modify: `extensions/README.md`
- Modify after Task 4: `extensions/ext-observability-sentry-node/README.md`
- Modify after Task 5: `extensions/ext-observability-sentry-deno/README.md`
- Modify: `src/observability/README.md`
- Create: `docs/guides/configure-application-error-reporting.md`
- Create: `docs/guides/migrate-sentry-error-reporting.md`
- Modify: `docs/guides/index.md`
- Modify: `tests/docs/guide-contracts.test.ts`
- Modify: `tests/docs/guide-code-examples.test.ts`
- Modify: `tests/docs/guide-content.test.ts`
- Modify: `docs/architecture/13-observability.md`
- Regenerate: `docs/api-reference/veryfront/observability.md`
- Regenerate: `docs/api-reference/veryfront/extensions.md`
- Regenerate: `docs/api-reference/veryfront/index.md`
- Regenerate: `docs/api-reference/veryfront/agent.md`
- Regenerate: `docs/api-reference/veryfront/server.md`
- Modify: `.github/workflows/cicd.yml`
- Create: `scripts/ci/release-notes.test.ts`
- Modify: `deno.json`
- Regenerate: `.github/dependency-free-core-inventory.json`
- Regenerate: `.github/DEPENDENCY-FREE-CORE.md`
- Modify: `.github/MODULE-HARDENING.md`

- [ ] Keep each document in one Diátaxis quadrant: the configuration and migration pages are **How-to guides** (high confidence: action-oriented work procedures), generated API pages are **Reference** (high confidence: structured lookup facts), and `docs/architecture/13-observability.md` is **Explanation** (high confidence: rationale and lifecycle tradeoffs). Keep both READMEs as brief indexes that link to those documents instead of embedding mixed-mode copies.

- [ ] Document explicit composition examples. Validate required environment input before constructing an extension; do not use a non-null assertion:

  ```ts
  import sentryDeno from "@veryfront/ext-observability-sentry-deno";
  import { defineConfig } from "veryfront";

  const sentryDsn = Deno.env.get("SENTRY_DSN");
  if (!sentryDsn) throw new Error("SENTRY_DSN is required");

  export default defineConfig({
    extensions: [
      sentryDeno({
        dsn: sentryDsn,
        serviceName: "veryfront-server",
      }),
    ],
    observability: {
      applicationErrors: { enabled: true, flushTimeoutMs: 2_000 },
    },
  });
  ```

  Scope this `defineConfig` example to a directly loaded, noncompiled local Deno config where the extension package is resolvable. Compiled, virtual-filesystem, dedicated, and hosted deployments use programmatic operator composition instead of assuming arbitrary bare imports can resolve inside temporary config modules. Add an operator-owned Node composition example that imports `sentryNode`, validates `process.env.SENTRY_DSN`, and passes `extensions` plus `applicationErrors` directly to `startNodeVeryfrontCloudAgentService()`. Shared hosted declarative config contains generic data only and never accepts executable extension imports or host globals; `{ enabled: true }` succeeds only when operator composition supplies exactly one provider and otherwise fails startup. Explain that provider environment access occurs in application/operator composition, never core. Extend `guide-content.test.ts` to reject documentation that presents executable providers as hosted declarative configuration, claims compiled config can resolve the extension import, or omits the missing-provider failure consequence.

- [ ] Add an intentional-breaking-change migration from `veryfront/observability/sentry` and `@veryfront/ext-observability-sentry/{node,deno}` to the two new packages. State explicitly that `SENTRY_DSN` alone no longer activates or imports reporting, `VERYFRONT_ERROR_REPORTER=sentry` is removed rather than deprecated, and installed explicit extensions do not auto-activate. Link each statement to the replacement composition/config example and make this page the canonical RC/stable release-note target.

- [ ] Update the existing RC and stable GitHub release-note bodies in `.github/workflows/cicd.yml` with the exact public link `https://veryfront.com/docs/code/guides/migrate-sentry-error-reporting` and those three breaking behaviors, without changing publication order or artifact ownership. Add `scripts/ci/release-notes.test.ts` to assert both release paths contain the same canonical facts. Preserve the current single well-formed `gh release list` RC cleanup pipeline and add a regression requiring exactly one invocation so the previously audited malformed-duplicate failure cannot recur; register the test in `test:scripts`.

- [ ] Add both how-to guides to `docs/guides/index.md`, give each an exact guide contract, and cover every fenced executable example in `guide-code-examples.test.ts`.

- [ ] Apart from the tested release-note/duplicate-command edit above, do not modify release scripts, publication topology, Homebrew, or `DISTRIBUTION.md` in this phase. Record their confirmed inconsistencies and the deferred release acceptance requirements in `.github/MODULE-HARDENING.md`; the later zero-edge release plan owns those changes and their source-contract tests.

- [ ] Regenerate the API reference and scan the reporter implementation/docs for unfinished markers:

  ```bash
  set -euo pipefail
  deno task docs
  deno task docs:generated:check
  deno task docs:validate
  marker_status=0
  rg -n 'TO''DO|FIX''ME|PLACE''HOLDER|implement la''ter|similar t''o' docs/superpowers/plans/2026-07-29-application-error-reporter-extension-boundary-implementation.md docs/guides/configure-application-error-reporting.md docs/guides/migrate-sentry-error-reporting.md docs/architecture/13-observability.md extensions/README.md src/observability src/extensions/observability extensions/ext-observability-sentry-node extensions/ext-observability-sentry-deno || marker_status=$?
  case "$marker_status" in
    0) echo "Unfinished implementation marker found" >&2; exit 1 ;;
    1) ;;
    *) echo "Unfinished-marker scan failed" >&2; exit "$marker_status" ;;
  esac
  git diff --check
  ```

- [ ] Run the focused and repository regression evidence set. The strict generic inventory remains expected-red and is reported separately; a green legacy aggregate is not described as dependency-free proof:

  ```bash
  set -euo pipefail
  deno task typecheck:extensions
  deno task test:scripts
  deno test --config=scripts/test.deno.json --frozen --no-check --allow-read scripts/ci/release-notes.test.ts
  deno test --frozen --allow-all src/observability/application-errors.test.ts src/extensions/observability/application-error-reporter.test.ts src/observability/application-error-dispatcher.test.ts src/extensions/orchestrate.test.ts src/extensions/loader.test.ts
  deno task build:npm
  deno task typecheck:consumer
  deno task typecheck:consumer:reporter
  bash scripts/test/npm-install-smoke.sh
  deno task verify:quick
  deno task verify
  ```

- [ ] After every Task 11 README, workflow, `deno.json`, generated API, and package build change is final, regenerate the complete Task 10 evidence. Those files are hashed producer inputs and the provider READMEs ship in extension tarballs, so Task 10's earlier inventory is stale by construction after this task. This refresh is the final artifact-producing step before the tracker update:

  ```bash
  set -euo pipefail
  deno task generate
  deno task generate:manifests:check
  core_evidence_dir="$(mktemp -d)"
  trap 'rm -rf -- "${core_evidence_dir:?}"' EXIT
  deno run --config=scripts/test.deno.json --frozen -A scripts/build/prepare-core-dependency-evidence.ts --output-dir "$core_evidence_dir/evidence"
  inventory_status=0
  deno run --config=scripts/test.deno.json --frozen --allow-read --allow-write --allow-run scripts/lint/core-dependency-inventory.ts --evidence-dir "$core_evidence_dir/evidence" --output .github/dependency-free-core-inventory.json --owner-table .github/DEPENDENCY-FREE-CORE.md || inventory_status=$?
  test "$inventory_status" -eq 2
  deno eval 'const report = JSON.parse(await Deno.readTextFile(Deno.args[0])); const examined = report.examined; if (report.evidenceComplete !== true || report.operationalErrors?.length !== 0 || !Array.isArray(report.issues) || report.issues.length === 0 || !examined || !Number.isInteger(examined.roots) || examined.roots < 1 || !Number.isInteger(examined.files) || examined.files < 1 || !Number.isInteger(examined.artifacts) || examined.artifacts < 1 || report.issues.some((issue) => typeof issue.owner !== "string" || issue.owner.length === 0)) Deno.exit(1);' .github/dependency-free-core-inventory.json
  ```

  Exit `3`, missing/changed input hashes, stale package bytes, unknown ownership, or an empty inventory is a failure. Recompute the inventory hash only from these final bytes; do not reuse Task 10's earlier hash.

- [ ] Interpret results without weakening the invariant. This plan may complete the reporter extraction and its inventory tooling when all reporter-specific assertions are green and the deterministic generic inventory is recorded. It may not claim core dependency freedom, release readiness, or module closure while that inventory is nonempty. The broader 58-unit hardening goal remains active.

- [ ] Update `.github/MODULE-HARDENING.md` with exact test commands and commit SHAs; the reporter-specific zero-edge evidence; the generic inventory path/hash and every owner-plan filename; the deferred release-tooling findings; and the next module. Do not record generic zero when the inventory is nonempty and do not increment a module to production-grade based only on this slice.

- [ ] Commit and push the final verified slice:

  ```bash
  set -euo pipefail
  git add extensions/README.md extensions/ext-observability-sentry-node/README.md extensions/ext-observability-sentry-deno/README.md src/observability/README.md docs/guides/configure-application-error-reporting.md docs/guides/migrate-sentry-error-reporting.md docs/guides/index.md tests/docs/guide-contracts.test.ts tests/docs/guide-code-examples.test.ts tests/docs/guide-content.test.ts docs/architecture/13-observability.md docs/api-reference/veryfront/observability.md docs/api-reference/veryfront/extensions.md docs/api-reference/veryfront/index.md docs/api-reference/veryfront/agent.md docs/api-reference/veryfront/server.md .github/workflows/cicd.yml scripts/ci/release-notes.test.ts deno.json .github/dependency-free-core-inventory.json .github/DEPENDENCY-FREE-CORE.md .github/MODULE-HARDENING.md
  test -z "$(git diff --name-only)"
  test -z "$(git ls-files --others --exclude-standard)"
  git diff --cached --check
  git commit -m "docs: document explicit reporter composition"
  git push origin codex/module-reconcile-20260723
  ```

## Plan Self-Review Checklist

- [ ] Every normative design acceptance criterion maps to at least one task and one executable assertion.
- [ ] No task asks core or CLI to import, discover, map, configure, or package a Sentry implementation.
- [ ] Public extension declarations are vendor-SDK-type-free, while provider identity remains explicit and honest.
- [ ] Node and Deno installation closures are independently tested without hoisting.
- [ ] Startup, steady-state, shutdown, retry, and stale-generation ownership are covered for server, CLI, proxy, and agent hosts.
- [ ] Source, manifests, JavaScript, declarations, maps, tarballs, browser graphs, binary module graphs, compile-input manifests, SBOMs, and dependency snapshots have distinct evidence owners; no unsupported physical-VFS claim is made.
- [ ] Zero-file and manifest-only false-green paths have regression tests.
- [ ] No baseline, fallback, compatibility shim, vendor allowlist, source probe, or silent degradation has been introduced.
- [ ] The final report distinguishes a completed Sentry extraction from the still-active repository-wide dependency-free-core goal.
