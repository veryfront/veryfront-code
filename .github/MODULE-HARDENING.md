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
| Closed                         |     5 |       8.6% | Current formal closure evidence remains valid       |
| Deep reviewed, fixes pending   |     0 |       0.0% | Review findings exist; remediation is not complete  |
| Touched, revalidation required |    38 |      65.5% | Substantive recovered or current work exists        |
| Pending current review         |    15 |      25.9% | No current authoritative-branch review delta exists |
| Total                          |    58 |     100.0% | All audit units                                     |

Closed, deeply reviewed, and touched units give current-cycle substantive
coverage of 43/58 (74.1%). This is progress coverage, not a substitute for the
stricter closure count.

### Closed

- `config`
- `embedding`
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
- `eval`
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

The current closed review chain covers `config`, `embedding`, and `metrics`.
Each closure includes a complete consumer map, deep module-level review,
adversarial boundary tests, public-contract documentation, and repository-wide
verification. Cross-module consumers changed by a fix remain in revalidation;
focused evidence for one boundary does not by itself close the consumer's
top-level unit. `eval` is the next pending review target because it is the
closest project-metrics consumer and has not yet received current-branch formal
closure.

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

These gates certify this integration checkpoint, not the 15 pending module
reviews or the reviewed `metrics` unit whose fixes are still pending. The broader
unit and integration portfolio remains part of the final repository production
gate.

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
