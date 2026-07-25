# Module hardening ledger

This ledger tracks the production-hardening review of the 58 `src` audit
units: 56 top-level module directories, one root-entrypoint unit covering
`src/index.ts` and `src/index.client.ts`, and `src/version.ts`.

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
| Closed                         |     9 |      15.5% | Current formal closure evidence remains valid       |
| Deep reviewed, fixes pending   |     2 |       3.4% | Reviewed remediation or design work remains open    |
| Touched, revalidation required |    37 |      63.8% | Substantive recovered or current work exists        |
| Pending current review         |    10 |      17.2% | No current authoritative-branch review delta exists |
| Total                          |    58 |     100.0% | All audit units                                     |

Closed, deeply reviewed, and touched units give current-cycle substantive
coverage of 48/58 (82.8%). This is progress coverage, not a substitute for the
stricter closure count.

### Closed

- `config`
- `embedding`
- `eval`
- `extensions`
- `metrics`
- `provider`
- `runtime`
- `schemas`
- `version.ts`

### Deep reviewed, fixes pending

- `prompt`
- `resource`

### Touched, revalidation required

- `agent`
- `build`
- `cache`
- `channels`
- `client`
- `data`
- `discovery`
- `errors`
- `fs`
- `html`
- `integrations`
- `internal-agents`
- `mcp`
- `middleware`
- `modules`
- `oauth`
- `observability`
- `platform`
- `proxy`
- `react`
- `registry`
- `release-assets`
- `rendering`
- `routing`
- `schedule`
- `security`
- `server`
- `skill`
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
- `mdx`
- `repositories`
- `runs`
- `sandbox`
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

The current closed review chain covers `config`, `embedding`, `eval`,
`extensions`, `metrics`, `provider`, `runtime`, `schemas`, and `version.ts`.
The latest independent adversarial provider and runtime findings are remediated
and revalidated. `prompt` and `resource` have now received deep current-state
reviews and substantial remediation, but remain open while their documented
cross-cutting findings are unresolved. Each closure requires a complete consumer map, deep
module-level review, adversarial boundary tests, public-contract documentation,
and repository-wide static verification. Cross-module consumers changed by a
fix remain in revalidation; focused evidence for one boundary does not by
itself close the consumer's top-level unit. The next target will be selected
from the remaining dependency-adjacent units after this checkpoint is
committed, pushed, and synchronized with `origin/main`.

### Main integration checkpoint

The reviewed history was previously rebased onto `origin/main`. The latest
upstream synchronization was merged from a clean, pushed checkpoint because
replaying the recovered merge topology would have forced already-reviewed
conflicts across the complete recovery chain. The merge incorporated only the
new upstream commits; its sole conflict retained two independent layout
applicator imports. The regenerated root lockfile passes frozen resolution,
generated manifests are current, and the repository and consumer-package
typecheck gates pass.

- `src/version.ts` remains intentionally absent. Its only content was a stale
  single-image build test comment, so removing the non-production marker closed
  that audit unit; its absence is not recovery loss.
- App-router SSR error rendering now reuses the exact project, content-source,
  and import-map identity captured during layout preloading, along with the
  request's layout data. A missing identity fails closed instead of resolving
  mutable project state or shifting positional arguments.
- `rendering` remains in touched/revalidation-required status. This focused
  integration repair and its passing tests are not a full module closure.
- The new upstream skill-loading, knowledge-cursor, module-resolution, and
  layout-routing surface passed 37 focused tests and 161 steps with zero
  failures.
- The post-sync repository unit suite passed 3,070 tests and 24,181 steps with
  zero failures; one intentional test remained ignored with five steps.
- Load-sensitive tests now use controlled cache time, an explicitly
  unauthenticated skill request context, and a production-realistic Redis
  acknowledgement budget instead of wall-clock or ambient-state assumptions.

### Prompt and resource remediation checkpoint

The current prompt/resource slice removes confirmed runtime lies and
fail-open behavior while keeping unresolved design work visible:

- Prompt configs now require static content or a generator in both the
  published TypeScript contract and runtime schema. Empty static content is
  preserved, async generators have a precise string contract, and invalid
  generator output is rejected at runtime.
- Static interpolation reads only caller-owned properties and preserves input
  verbatim. The bypassable, mutable regex blacklist was removed rather than
  being represented as a security boundary.
- Auto-discovery preserves explicit prompt IDs and resource URI patterns while
  replacing only factory-generated placeholders. Discovery paths are portable,
  encoded safely, and reject outside-root, traversal, NUL, and malformed
  percent-encoding inputs.
- Resource patterns use one validated grammar for registration, lookup,
  parameter extraction, and URI-template rendering. Duplicate parameters,
  ambiguous patterns, derived-ID collisions, regex metacharacter drift, and
  registration-order shadowing fail deterministically.
- Resource load and direct subscription paths both validate and pass transformed
  parameters. Same-millisecond generated patterns are unique.
- MCP hides resources with `mcp.enabled: false`, separates concrete resources
  from templates, does not advertise unsupported subscriptions, maps malformed
  parameters to stable protocol errors, emits normalized telemetry, and rejects
  non-bounded-JSON output.
- MCP and the local dashboard validate prompt arguments and unknown IDs, return
  configured descriptions, and redact generator failures. The starter agent
  template now awaits its registered prompt instead of always selecting a
  synchronous fallback.
- Request-time rediscovery atomically clears stale prompt and resource entries,
  and hard source-read failures preserve the previous live generation.
- The MCP how-to, prompt/resource explanations, generated API reference, and
  published-package type fixture now match the implemented contracts.

Reproducible evidence for this open checkpoint:

- The focused prompt, resource, MCP, discovery, and dashboard boundary surface
  passed 31 suites and 263 steps with zero behavioral failures.
- Four isolation-sensitive discovery and hosted-agent suites passed 71 steps
  serially with zero failures.
- The published-package consumer fixture, generated documentation, public-doc
  validation, and all 723 documentation links pass.
- `deno task verify:quick` passes generated-manifest checks, formatting, lint
  and architecture ratchets, documentation validation, and every configured
  entrypoint typecheck.
- The corrected test-server adapter passes the full lifecycle, dev-server, and
  production-health suites: 47 steps pass, with one intentional dev-server
  virtual-module step ignored. It wraps readonly runtime handles and reports
  the actual ephemeral port instead of mutating production objects.

The repository-wide test gate now passes after the cross-module remediation
checkpoint below: 3,540 tests and 28,025 steps passed with zero failures; one
intentional test with 36 steps remains ignored. This broad result resolves the
previous cache, config, and production-server regressions, but it does not
close the prompt/resource design findings listed below.

The following findings deliberately keep both modules in
`Deep reviewed, fixes pending`:

- Public registry facades still expose process-wide shared registration,
  global reset, and aggregate statistics to evaluated project code. That
  registry-wide capability split must cover prompts, resources, tools, skills,
  agents, and workflows together.
- Finalized detached request work can still fall back to the default registry
  scope. A revoked-context sentinel must fail closed without retaining request
  credentials.
- Dev-server HMR still needs one atomic discovery replacement, shared
  configured paths, and rollback on partial discovery errors.
- Prompt generators still need an additive cancellation/deadline context.
  MCP prompt argument metadata, private-prompt exposure, and automatic
  list-change notification semantics require an explicit public contract.
- Resource `mcp.cachePolicy` remains a reserved but unenforced setting. Cache
  key, TTL, invalidation, and failure semantics require a deliberate API
  decision; no behavior was invented for an existing no-op knob.
- Discovery still needs a deterministic relative-path fallback and structured
  duplicate/invalid-export diagnostics for nested prompt names.
- Resource canonicalization for query/fragment variants and non-JSON content
  modes remains an explicit transport-design decision.

### Cross-module cache, routing, and production-server remediation checkpoint

This checkpoint resolves the repository-wide regressions exposed after the
prompt/resource work without converting focused fixes into formal closure of
the affected top-level units:

- Dependency discovery lowers authored TypeScript, JSX, TSX, and MDX through
  one shared syntax-normalization path before lexing. SSR memory, distributed,
  and MDX-ESM cache identities now include the complete local dependency graph,
  so an unchanged parent cannot retain transformed paths for a changed child.
- SSR singleflight returns the exact transformed entry to leaders and waiters
  instead of recovering it through mutable global cache state. Failed graph
  scans use request-local coordination, bypass persistent and in-memory cache
  publication, and cannot alias with a valid no-dependency graph.
- Configuration module selection is based on default-export presence rather
  than truthiness. Explicit falsy defaults reach structured schema validation,
  while named-export-only modules retain their compatibility behavior.
  Sequential bootstrap lifecycles restore the shipped bundler contracts before
  early configuration transforms.
- Malformed import-map JSON fails closed instead of silently replacing authored
  resolution with defaults. Project source-miss invalidation is tenant-scoped
  and leaves unrelated project entries intact.
- App Router page resolution skips a conventional page candidate only when
  filesystem metadata proves it is not a file; operational read failures remain
  observable. Catch-all parameters are slash-flattened consistently for both
  in-process and isolated App Router handlers, and the worker protocol rejects
  unflattened arrays at that boundary.
- Local-development policy and permission to execute project modules in the
  host process are now separate capabilities. Explicit local projects and
  non-proxy disk-backed standalone projects may load their API modules;
  proxy-backed and virtual-filesystem projects fail closed. Admission reads
  only own data properties, so inherited or accessor-based capability forgery
  cannot authorize execution. Development error-detail and response-header
  behavior continues to depend on actual locality rather than this narrower
  execution permission.
- API discovery, route execution, and OpenAPI inspection share that
  host-execution boundary. This restores compiled standalone API routes without
  reclassifying production projects as local or weakening their security
  headers.
- Standalone cache-isolation slugs no longer imply a credentialed proxy
  filesystem. Hosted middleware integration verifies authoritative routing and
  environment metadata, and server test handles register idempotent cleanup so
  failed assertions cannot poison later lifecycle tests.
- The default parallel test portfolio no longer races two suites that own the
  same compiled-binary artifact. Core and virtual-filesystem proxy coverage run
  through explicit serial tasks, with static task-boundary and artifact-
  ownership regressions guarding that split.

Reproducible checkpoint evidence:

- The config loader, bootstrap, schema, import-map, and integration surface
  passed 11 suites and 274 steps with zero failures.
- The SSR loader regression surface passed 21 steps with zero failures,
  including stale artifacts, missing dependencies, singleflight eviction, and
  uncacheable publication behavior.
- The route executor, worker boundary, page resolver, and two production-server
  integration suites passed 180 focused steps with zero failures.
- The host-execution, handler-context, API-wrapper, OpenAPI, route-executor,
  adapter, and production-server surface passed 10 focused suites and 304 steps
  with zero failures.
- The exact-source compiled-binary core lane passed 61 steps. Its separate
  virtual-filesystem proxy lane passed three steps, including the fail-closed
  no-API-token path; the live token-dependent assertion remains conditional.
- Three focused task-boundary, artifact-ownership, and readiness-cancellation
  regressions passed. Early child-process exit now cancels the losing HTTP poll
  instead of leaving it alive until the suite deadline.
- `deno task verify:quick` passed generated manifests, formatting, lint and
  architecture ratchets, documentation validation, and every configured
  entrypoint typecheck.
- `deno task typecheck:consumer` rebuilt the root npm package and every
  first-party extension package, verified root import lifecycle behavior, and
  passed the documented consumer-composition typecheck.
- `deno task test` passed 3,540 tests and 28,025 steps with zero failures; one
  intentional test with 36 steps remained ignored.

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

The embedding findings are remediated on the current branch:

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

### Extensions remediation checkpoint

The extensions findings are remediated on the current branch:

- Extension factories, metadata, contract names, capability scopes, lifecycle
  hooks, dynamic module exports, and registry entries are validated at their
  runtime boundaries. Hostile accessors and thrown values produce bounded,
  contextual failures instead of escaping audit or cleanup paths.
- Dynamic `provide()` calls are restricted to declared contracts. Required
  contracts and primed infrastructure are preflighted before activation, and
  declared winning contracts must actually be published. Source priority is
  immutable, discovery order is deterministic, and ambiguous same-priority
  providers fail closed.
- Setup generations are serialized. Timeouts revoke registry authority,
  teardown is reverse ordered and retryable, late non-cooperative setup remains
  quarantined, and invalid replacements do not tear down the active
  generation.
- Parser, bundler, LLM-provider, and eval-exporter registrations validate
  their concrete method surfaces and capture identity once. Malformed
  registrations cannot mutate registries, exporter failures do not abort later
  exporters, and teardown uses the captured identity rather than mutable
  accessors.
- Optional first-party built-ins are filtered by disable directives and source
  priority before import. Remaining candidates materialize before lifecycle
  activation and use the factory's actual contracts and capabilities, removing
  the duplicated hardcoded metadata table. Missing packages are skipped;
  broken factories, invalid metadata, identity drift, and unavailable required
  contracts fail before replacement.
- Deferred built-in state is opaque, branded, immutable, and definition
  snapshots are stable. The public loader and orchestration signatures remain
  on the existing `ResolvedExtension[]` contract; the implementation did not
  leak a new authoring API into generated declarations.
- OpenTelemetry and sandbox extension dependencies are stripped from the root
  npm package boundary. `gaxios`, `gcp-metadata`, and `brace-expansion` now ship
  only with the extension packages that own them.
- The extension guide documents optional-package selection, preflight failure,
  and active-generation preservation. Generated API references were refreshed
  deterministically.

Reproducible checkpoint evidence:

- The complete `src/extensions` surface passed 24 test suites and 275 steps
  with zero failures, including adversarial validation, registry, priority,
  timeout, rollback, quarantine, and deferred-materialization coverage.
- The Kreuzberg built-in integration passed one suite and five end-to-end
  steps, including upload extraction through the registered
  `DocumentExtractor`.
- Binary inclusion and npm package-boundary coverage passed 23 tests and 44
  steps with zero failures.
- `deno task docs:validate` passed 45 groups and 87 steps plus all 720 link
  checks.
- `deno task verify:quick` passed manifests, formatting, lint and architecture
  ratchets, extension contract and capability audits, documentation
  validation, and every configured entrypoint typecheck.
- `deno task typecheck:consumer` rebuilt the root npm package and all
  first-party extension packages, verified root import lifecycle behavior, and
  passed the documented consumer-composition typecheck against generated
  declarations.

No unresolved critical or high-confidence extensions production risk remains.

### Provider remediation checkpoint

The provider findings are remediated on the current branch:

- Model and embedding registry inputs, provider identities, configuration
  buckets, model catalogs, runtime inspection, usage records, and remote
  response envelopes validate at their trust boundaries. Project-specific
  runtime resolution remains isolated instead of leaking credentials or
  provider configuration across tenants.
- Local inference pipelines use bounded caches and explicit leases. Concurrent
  loads are deduplicated, cancellation releases waiters without corrupting an
  active generation, failed initialization is not cached as success, eviction
  waits for active users, and stop remains idempotent.
- Provider HTTP requests validate endpoints and request initialization, apply
  deadlines and cancellation, bound response and error bodies, redact
  credentials, parse server-sent events incrementally, and normalize retries
  and usage without inventing missing evidence.
- Veryfront Cloud preserves its provider identity and nested model IDs while
  canonicalizing endpoints and rejecting malformed catalogs and responses.
- Anthropic, Google, and OpenAI runtimes retain provider-native reasoning,
  citations, grounding, tool calls, usage, and ordered stream state without
  flattening protocol data that a later turn needs.
- Usage normalization emits both the canonical `cacheReadInputTokens` field
  and the compatibility `cachedInputTokens` alias with one value. Canonical
  input wins when both are present, and descriptor-based reads prevent alias
  accessors or prototype pollution from participating.
- OpenAI Responses calls are stateless and retain the complete ordered output
  history in provider metadata. Reasoning calls request encrypted content, and
  hosted web-search calls retain their source list so exact replay remains
  possible without server-side storage.
- Provider-executed OpenAI Responses history cannot be replayed through Chat
  Completions. That mismatch now fails before transport as a structured config
  error while preserving the public `TypeError` compatibility contract.
- OpenAI-hosted web search is available through the public agent tool
  inventory. Requests that configure it route through Responses even for
  otherwise chat-completions models; ordinary calls keep their existing
  transport. Unsupported hosted tools and malformed provider output fail
  before reaching agent execution.
- Public provider guidance and the OpenAI extension reference document routing,
  hosted-search IDs and limits, stateless replay, cancellation, local-runtime
  behavior, and the provider-native metadata callers must preserve.

Reproducible checkpoint evidence:

- The complete `src/provider` surface passed 27 tests and 223 steps with zero
  failures; five model-download steps remain intentionally ignored.
- The Anthropic, Google, and OpenAI extension surfaces passed 19 test modules
  and 412 steps with zero failures.
- The affected agent, hosted-runtime, fork, and internal-agent consumer surface
  passed 73 suites and 95 steps with zero failures.
- `deno task docs:validate` passed 45 groups and 87 steps plus all 723 link
  checks. The API-reference generator regression also passes in isolation.
- `deno task verify:quick` passed manifests, formatting, lint and architecture
  ratchets, documentation validation, and every configured entrypoint
  typecheck.
- `deno task typecheck:consumer` rebuilt the root npm package and all
  first-party extension packages, verified root import lifecycle behavior, and
  passed the documented consumer-composition typecheck against generated
  declarations.

The raw OpenAI `providerOptions` escape hatch remains compatibility-oriented:
advanced callers can still override `tools`, `tool_choice`, or the chat
completions `n` field. Removing those overrides would be behavior-breaking.
The normalized runtime path does not emit them, registered provider tool output
is still validated, and this surface is not advertised as a supported
high-level contract. It requires an explicit deprecation or breaking-change
decision before removal. No unresolved critical or high-confidence provider
production risk remains.

### Runtime remediation checkpoint

The runtime findings are remediated on the current branch:

- `src/runtime` is the framework-owned model-runtime trust bridge, not a host
  runtime detection layer. Provider call options, immutable prompt views,
  assistant provider-tool content, reasoning controls, structured-output
  options, and tool definitions now have one canonical provider contract.
- Direct and streamed provider output is parsed through descriptor-based
  boundary validators. Known fields are copied into canonical shapes,
  malformed known events and unsafe accessors fail closed, unknown direct
  provider-specific records retain their compatibility behavior, and stream
  events cannot smuggle unknown top-level fields. Requested raw chunks cross
  the boundary only as bounded, deeply owned JSON snapshots.
- Streams require one terminal finish or error, reject output after terminal
  state, preserve correlated deferred provider results across continuation
  boundaries, and surface provider error events consistently through
  buffered, full-stream, and text-stream paths.
- Generation, stream startup and reads, schema materialization, repair, and
  embedding calls honor cancellation even when a runtime does not cooperate.
  Lazy stream requests are not started for abandoned consumers, source streams
  are cancelled once, and one branch of a concurrent dual view can finish or
  cancel without prematurely terminating its peer.
- Tool identity comes from the resolved registry rather than caller-controlled
  markers. Repairs are revalidated once, missing results fail with correlated
  errors, repeated terminal provider results are idempotently ignored, and
  provider-controlled input is limited to 128 calls, 1 MiB per call, 8 MiB per
  turn, and 4,096 deltas per streamed input.
- Direct and streamed usage share one sanitizer. Invalid, negative,
  fractional, unsafe, or non-finite counters and costs are omitted; valid
  component totals repair underreported totals without inventing missing
  evidence. Exact AI SDK provider-v3 and v6 cache/reasoning shapes are mapped,
  only own data properties participate, and canonical data-only records cannot
  resolve absent fields through a polluted global prototype.
- Tool, validator, and repair failures are formatted from own error messages or
  descriptor-only JSON snapshots. Failure handling does not invoke getters,
  `toJSON`, or coercion hooks, revoked proxies fail closed, and diagnostic text
  is capped at 4 KiB of UTF-8 before it reaches logs, clients, or models.
- Embedding invocation and cosine similarity now belong to `src/embedding`
  instead of leaking through the generation bridge. Extreme finite vector
  magnitudes remain numerically stable.
- OpenAI, Anthropic, and Google replay metadata is deeply owned, bounded JSON.
  Surviving canonical calls and results must match raw provider history
  occurrence-for-occurrence and in order; duplicated, reordered, mutated, or
  semantically mismatched history fails before transport. Google replay accepts
  either the current raw-position ID scheme or the complete historical
  anonymous-occurrence scheme, resets historical IDs for each assistant turn,
  and rejects duplicates or mixed schemes.
- Anthropic replay accepts structurally exact serialized provider errors after
  a JSON round trip, rejects extra fields and unsafe accessors, and treats a
  complete empty stream as valid rather than inventing malformed metadata.
- Non-finite JSON tool arguments retain their correlated parse failure instead
  of collapsing into a misleading missing-result error. Diagnostic extraction
  remains brand-safe for native `DOMException` getters.
- Public reference, architecture explanation, provider how-to guidance, and
  vendor extension references document the runtime boundary, raw-event
  ownership, replay correlation, compaction, cancellation, and resource
  limits.

Reproducible checkpoint evidence:

- The complete `src/runtime` and `src/agent/runtime` regression surface passed
  287 test modules and 741 steps with zero failures.
- The revalidated `src/provider` surface passed 27 tests and 223 steps with
  zero failures; five model-download steps remain intentionally ignored.
- The revalidated Anthropic, Google, and OpenAI extension surfaces passed 19
  test modules and 412 steps with zero failures.
- The affected `src/errors` regression surface passed 30 test modules and 501
  steps with zero failures. This boundary evidence does not itself close the
  top-level `errors` audit unit.
- The revalidated `src/embedding` surface passed eight tests and 157 steps with
  zero failures.
- The `src/extensions` orchestration surface passed 24 tests and 275 steps with
  zero failures.
- The repository unit suite passed 3,070 tests and 24,181 steps with zero
  failures; one intentional test remained ignored with five steps.
- `deno task docs:validate` passed every public-doc contract and all 723 link
  checks.
- `deno task verify:quick` passed generated-manifest checks, formatting, lint
  and architecture ratchets, dependency and module boundaries, documentation
  validation, and every configured entrypoint typecheck.
- `deno task typecheck:consumer` rebuilt the root npm package and all
  first-party extension packages, verified root import lifecycle behavior, and
  passed the documented consumer-composition typecheck against generated
  declarations.
- `deno task test:scripts` passed 71 tests and 155 steps with zero failures.
- The built package passed all 68 documented export-path checks and 86 Node
  runtime checks across 19 public modules.
- The Node 18.18.0/npm 9.8.1 install smoke passed all six CLI,
  evaluator-worker, optional-peer, extension, and transitive-failure stages.
- Ajv was raised from 8.17.1 to the first patched 8.18.0 release. Its schema
  extension passed two suites and 39 steps, the rebuilt package reported zero
  vulnerabilities, and `deno task audit` found no vulnerabilities across all
  58 workspace npm dependencies.

No unresolved critical or high-confidence runtime production risk remains.
The following bounded residuals are explicit rather than hidden:

| Severity | Surface                                | Evidence and consequence                                                                                                                                                                                                                                                                                                                                   | Required resolution                                                                                                                                                    |
| -------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Low      | Same-realm Proxy reflection            | JSON snapshots avoid ordinary property reads, getters, and `toJSON`, and sanitize reflection failures. JavaScript must nevertheless invoke a Proxy's `getPrototypeOf`, `ownKeys`, and `getOwnPropertyDescriptor` traps while inspecting it. A Proxy already represents executable code in the same realm; portable JavaScript has no trap-free Proxy test. | Use a worker, process, or serialized boundary when the producer itself is not trusted to execute.                                                                      |
| Low      | Wide-object key materialization        | Object snapshots must obtain a complete own-key list before enforcing the node limit, so a pre-existing extremely wide object can cause a transient O(keys) key-array allocation. Provider body, item, node, and byte limits bound ordinary paths.                                                                                                         | Use a streaming serialization or isolated process boundary if this stronger protection is required.                                                                    |
| Moderate | Public non-finite cosine compatibility | `similarity()` is stable for extreme finite vectors and provider-produced embeddings reject non-finite coordinates before storage, but direct callers passing `NaN` or infinity retain the historical non-finite result. Throwing or normalizing would be behavior-breaking.                                                                               | Resolve through an explicit compatibility or deprecation decision, accompanied by public documentation and regression tests, before changing the direct-call behavior. |

### Config closure checkpoint verification

The current config closure checkpoint has the following reproducible evidence:

- The latest loader revalidation preserved explicit falsy defaults for schema
  rejection, retained named-export-only modules, and aligned integration
  assertions with structured `config-validation-failed` errors. The affected
  config/bootstrap/import-map surface passed 11 suites and 274 steps with zero
  failures.
- The complete changed test surface passed 81 test groups and 773 steps with
  zero failures, including loader, evaluator, worker, schema, discovery,
  environment, paths, hosted policy, retry, token, runs, GitHub, documentation,
  and release-asset regressions.
- The current repository suite passed 3,540 tests and 28,025 steps with zero
  failures; one intentional test with 36 steps remains ignored.
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
reviews or the 35 touched units that still require current-branch
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
