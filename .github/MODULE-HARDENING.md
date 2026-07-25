# Module hardening ledger

This ledger tracks the production-hardening review of the 58 `src` audit
units: 56 top-level module directories plus `src/index.ts` and
`src/version.ts`.

The ledger is updated in the same checkpoint as the hardening changes it
describes. Branch `codex/module-reconcile-20260723` HEAD is authoritative;
copied commit hashes are deliberately not used as a freshness signal.

## Status rules

A unit is closed only when all of these conditions are met:

- The current implementation received a deep module-level review.
- Relevant behavior, failure paths, boundaries, and tests were inspected.
- Required fixes and documentation updates are complete.
- Focused verification and affected integration gates pass.
- No later commit changed the unit without module-level revalidation.

A later source change reopens a closed unit. Recovered or mechanically applied
changes count as evidence, but do not by themselves certify the current unit.
Generated-only changes do not count as module review evidence.

## Current status

| Status                         | Count | Percentage | Meaning                                             |
| ------------------------------ | ----: | ---------: | --------------------------------------------------- |
| Closed                         |     6 |      10.3% | Current formal closure evidence remains valid       |
| Deep reviewed, fixes pending   |     0 |       0.0% | Review findings exist; remediation is not complete  |
| Touched, revalidation required |    38 |      65.5% | Substantive recovered or current work exists        |
| Pending current review         |    14 |      24.1% | No current authoritative-branch review delta exists |
| Total                          |    58 |     100.0% | All audit units                                     |

Closed, deeply reviewed, and touched units give current-cycle substantive
coverage of 44/58 (75.9%). This is progress coverage, not a substitute for the
stricter closure count.

### Closed

- `config`
- `embedding`
- `eval`
- `metrics`
- `schemas`
- `version.ts`

### Deep reviewed, fixes pending

None.

### Touched, revalidation required

- `agent`
- `build`
- `cache`
- `channels`
- `client`
- `data`
- `discovery`
- `errors`
- `extensions`
- `fs`
- `html`
- `integrations`
- `internal-agents`
- `middleware`
- `modules`
- `oauth`
- `observability`
- `platform`
- `provider`
- `proxy`
- `react`
- `registry`
- `release-assets`
- `rendering`
- `routing`
- `runtime`
- `schedule`
- `security`
- `server`
- `task`
- `testing`
- `tool`
- `transforms`
- `trigger`
- `types`
- `utils`
- `webhook`
- `index.ts`

### Pending current review

- `chat`
- `issues`
- `knowledge`
- `markdown`
- `mcp`
- `mdx`
- `prompt`
- `repositories`
- `resource`
- `runs`
- `sandbox`
- `skill`
- `studio`
- `workflow`

## Historical recovery context

Before the worktree loss, 46 of 58 units had formal closure evidence and all 58
had received a first-pass audit. The recovered changes remain in the branch.
That historical closure count is 79.3 percent.

The recovered snapshot was mechanical rather than a reviewed integration
commit. The current ledger therefore distinguishes preserved work from current
certification. This prevents a recovered diff, a later cross-module change, or
a passing repository-wide test from being mistaken for a fresh deep review of
every affected unit.

## Active review chain

The current closed review chain covers `config`, `embedding`, `metrics`, and
`eval`. Each closure includes a complete consumer map, deep module-level
review, adversarial boundary tests, public-contract documentation, and
repository-wide verification. Cross-module consumers changed by a fix remain
in revalidation; focused evidence for one boundary does not by itself close
the consumer's top-level unit. `extensions` is the next dependency-adjacent
revalidation target because eval construction and parsing use its built-in
schema-validator boundary.

### Rebase integration checkpoint

The reviewed history was rebased onto the then-current `origin/main`. The
regenerated root lockfile passes frozen resolution, generated manifests are
current, and the repository and consumer-package typecheck gates pass.

- `src/version.ts` remains intentionally absent. Its only content was a stale
  single-image build test comment, so removing the non-production marker closed
  that audit unit; its absence is not recovery loss.
- App-router SSR error rendering now reuses the exact project, content-source,
  and import-map identity captured during layout preloading, along with the
  request's layout data. A missing identity fails closed instead of resolving
  mutable project state or shifting positional arguments.
- `rendering` remains in touched/revalidation-required status. This focused
  integration repair and its passing tests are not a full module closure.

### Metrics remediation checkpoint

The metrics findings are remediated on the current branch:

- Direct OTLP records snapshot their destination, headers, resource identity,
  and temporality at emission, so later project-environment changes cannot
  reroute or relabel queued data.
- Export state is isolated per destination and serialized with one in-flight
  request. Cumulative and delta counter/histogram state preserves updates made
  during export; gauges retain the latest value.
- Failed network requests, timeouts, and retryable 429, 502, 503, and 504
  responses retain the batch for bounded exponential retry. Requests time out
  after ten seconds, automatic retries stop after five attempts, and exhausted
  destinations are evictable under the 16-destination capacity limit.
- OTLP JSON uses decimal strings for 64-bit histogram counts and bucket counts,
  emits stable instrument metadata, canonicalizes and validates endpoints and
  headers, and applies the configured cumulative, delta, or low-memory
  temporality preference.
- Metric names, values, metadata, attributes, instrument caches, gauge series,
  direct series, destinations, batches, payloads, headers, and endpoints have
  explicit bounds. Invalid or over-budget measurements are dropped without
  escaping into application code.
- Local instruments follow the OpenTelemetry metrics-provider revision.
  Provider replacement rebuilds instruments and detaches observable-gauge
  callbacks instead of continuing to publish through a retired provider.
- The project-facing metrics facade is immutable. Process-wide reset and test
  flush controls were removed from the public runtime module and moved behind
  a source-internal, non-exported testing boundary.
- Direct flush is an explicit public lifecycle operation that always resolves.
  The guide and generated API reference document validation, cardinality,
  routing, temporality, retry, timeout, failure-isolation, and flush behavior.

Reproducible checkpoint evidence:

- The focused metrics and affected-consumer surface passed 13 test suites and
  127 steps with zero failures. The metrics SDK itself passed 28 adversarial
  steps covering project isolation, provider replacement, OTLP serialization,
  cumulative and delta concurrency, retry exhaustion, timeout, destination
  eviction, cardinality, and unsafe configuration.
- `deno task docs:validate` passed 45 groups and 87 steps plus all 716 link
  checks.
- Core dependency, dependency-boundary, and module-boundary audits passed.
- `deno task verify:quick` passed manifests, formatting, lint and architecture
  ratchets, documentation validation, and all configured entrypoint
  typechecks.
- `deno task typecheck:consumer` rebuilt the npm and extension packages and
  passed the documented consumer-composition typecheck against the generated
  declarations.

The removal of the public process-wide metrics test controls was explicitly
approved on 2026-07-25. No unresolved critical or high-confidence metrics
production risk remains.

### Embedding remediation checkpoint

The non-breaking embedding findings are remediated on the current branch:

- Upload source, multipart-body, extracted-text, CSV record/column/field, list,
  and local-store reads are bounded and validated before persistence.
- Text MIME types and UTF-8 are validated. CSV parsing handles quoted fields,
  escaped quotes, CRLF, and multiline records while rejecting malformed or
  amplifying inputs.
- Request cancellation reaches multipart reads, extraction workers, RAG
  admission, embedding providers, and cloud mutations. Cloud ingestion rolls
  back partial chunks and document records on cancellation or publication
  failure.
- Local and cloud RAG stores validate mutation metadata before writes, persist
  upload size and media type, and enforce upload provenance before deletion.
- Upload listing is upload-only, deterministically ordered, paginated, and
  enriched with bounded Cloud metadata lookups. Deletion is idempotent and
  reports incomplete Cloud source cleanup as retryable instead of returning a
  false success.
- Internal failures are logged without returning provider or persistence
  details to clients. The React upload registry retains failed deletions so the
  user can retry.
- Upload routes require an explicit authorization policy at construction.
  Authorizers permit access only by returning literal `true`; `false` and
  invalid runtime results fail closed with 401. Intentionally public routes
  retain a conspicuous `allowUnauthenticated: true` opt-in.
- Public API reference and the RAG how-to guide document limits, pagination,
  provenance, cancellation, retry behavior, and the fail-closed authorization
  contract.

Reproducible checkpoint evidence:

- The embedding, provider, and knowledge regression surface passed 24 test
  groups and 277 steps with zero failures; five model-download steps remain
  intentionally ignored.
- The upload registry React suite passed six steps, and the Kreuzberg extension
  suite passed 16 steps, including explicit cancellation propagation.
- `deno task docs:validate` passed 45 groups and 87 steps plus all 716 link
  checks.
- `deno task verify:quick` passed manifests, formatting, lint and architecture
  ratchets, documentation validation, and all configured entrypoint
  typechecks.
- `deno task typecheck:consumer` rebuilt the npm and extension packages and
  passed the documented consumer-composition typecheck against the generated
  declarations.

The deliberate upload-auth compatibility break was explicitly approved on
2026-07-25. `createUploadHandler()` now requires `auth`, omission fails at
construction, and an authorizer must return literal `true` to allow access.
Regression tests cover omitted configuration, `false`, invalid `undefined`
runtime results, custom `Response` denials, successful authorization, and the
explicit public opt-in. No unresolved critical or high-confidence embedding
production risk remains.

### Eval remediation checkpoint

The eval findings are remediated on the current branch:

- Definitions, datasets, targets, repetitions, metric thresholds, judge
  limits, custom evaluators, and check callbacks validate their runtime
  contracts. Adapter, evaluator, metric, and check failures are contained in
  the affected record instead of aborting the remaining eval.
- Operational token and cost budgets fail closed when their required evidence
  is absent. Cost selection follows the documented billed-charge, metered
  charge, legacy cost, and provider-cost order.
- Baselines must match definition, target, and dataset identity. Model
  comparisons validate policies and report identity, reject colliding artifact
  paths, preserve unmeasured values, and avoid insertion-order promotion.
- Discovery rejects duplicate eval IDs. Provenance handles dirty and untracked
  state without making git availability a run requirement. JUnit output marks
  record execution errors as testcase failures.
- Live-eval case IDs cannot bypass write or experimental authorization gates.
  Unknown, duplicate, disabled, malformed, and empty selections fail before
  execution, and an all-skipped run exits unsuccessfully.
- Agent-service and canary clients validate identifiers, payloads, portable
  timer ranges, upload sizes, finite response values, and canonical metadata.
  URL path segments are encoded, API errors retain structured status and
  bounded bodies, caller cancellation reaches polling, and streamed uploads
  set Node-compatible duplex mode.
- Live and durable runners contain preparation, streaming, verifier, judge,
  sidecar, and cleanup failures. Cleanup remains ordered and observable even
  for hostile thrown values. Durable polling honors its configured deadline
  and retains the generated run ID when a later operation fails.
- The eval how-to guide documents baseline identity, fail-closed budgets,
  billing selection, live mutation gates, lifecycle failure behavior, and
  all-skipped exit semantics. Generated API references were refreshed
  deterministically.

Reproducible checkpoint evidence:

- The complete eval surface passed 17 test suites and 142 steps with zero
  failures, including adversarial agent-service, live-eval, API, and durable
  canary coverage.
- `deno task docs:validate` passed 45 groups and 87 steps plus all 720 link
  checks.
- Formatting, lint, focused typechecking, and diff-integrity checks passed for
  the complete eval surface.
- Repository quick verification and generated-consumer typechecking passed at
  the closure checkpoint.

No unresolved critical or high-confidence eval production risk remains.

### Config closure checkpoint verification

The current config closure checkpoint has the following reproducible evidence:

- The complete changed test surface passed 81 test groups and 773 steps with
  zero failures, including loader, evaluator, worker, schema, discovery,
  environment, paths, hosted policy, retry, token, runs, GitHub, documentation,
  and release-asset regressions.
- The repository unit suite passed 2,982 tests and 23,584 steps with zero
  failures; one intentional case remains ignored with five steps.
- `deno task verify:quick` passed, including formatting, linting, static policy
  ratchets, sanitizer and skipped-test baselines, dependency and module
  boundaries, documentation validation, and full entrypoint typechecking.
- `deno task test:scripts` passed 71 tests and 155 steps with zero failures.
- `deno task typecheck:consumer` rebuilt the npm and extension packages and
  passed the documented consumer-composition typecheck.
- The config-loader smoke passed five consecutive runs under Bun 1.3.14.
- The read-only Node 18.18.0 package smoke passed all six install, CLI,
  evaluator-worker, optional-peer, extension, and transitive-failure checks.
- `deno task docs:validate` passed all documentation contracts and 716 link
  checks.

These gates certify this integration checkpoint, not the 14 pending module
reviews or the 38 touched units that still require current-branch
revalidation. The broader unit and integration portfolio remains part of the
final repository production gate.

### Config residual debt

The following bounded residuals are explicitly accepted. No critical or high
config finding remains open.

| Severity | Surface                                              | Evidence and consequence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Required resolution                                                                                                                                                  |
| -------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Moderate | Compatibility-only project fields                    | The schema, merge, extension boundary, and render-cache identity preserve `title`, `description`, `directories.ai`, `theme.colors`, `build.outDir/trailingSlash/esbuild`, `dev.host/open/hmrPort`, `theming`, `assetPipeline`, tracing/metrics project config, `search`, `fs.local.baseDir`, `fs.memory`, provider defaults, `ai.work`, `ai.mcp`, Tailwind plugin/theme/custom-CSS fields, and `openapi.mcp`. Core has no documented built-in semantics for these fields; silently treating schema acceptance as implementation would mislead users, while removing them would break extension and cache contracts. | Give a field one authoritative owner plus end-to-end tests before claiming built-in behavior, or use an explicit deprecation/breaking-change process before removal. |
| Low      | Cancellation of an already-active hosted source read | Loader waiters, admission, and queued reads honor `AbortSignal`, but the current filesystem adapter `readFile` contract cannot receive a signal. When the last waiter aborts, an active adapter read therefore remains counted against the two-read limit until the adapter settles. This preserves fail-closed accounting but cannot reclaim underlying I/O early.                                                                                                                                                                                                                                                 | Evolve the filesystem adapter contract and implementations to accept cancellation, then add adapter-level abort and resource-release tests.                          |

The compatibility surfaces are also documented in `src/config/README.md` and
the public configuration guide. A module-hardening pass must not erase them as
incidental cleanup.

Update this ledger in the same commit that closes or reopens an audit unit.
