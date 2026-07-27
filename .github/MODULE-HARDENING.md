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
| Closed                         |    35 |      60.3% | Current formal closure evidence remains valid       |
| Deep reviewed, fixes pending   |     3 |       5.2% | Reviewed remediation or design work remains open    |
| Touched, revalidation required |    20 |      34.5% | Substantive recovered or current work exists        |
| Pending current review         |     0 |       0.0% | No current authoritative-branch review delta exists |
| Total                          |    58 |     100.0% | All audit units                                     |

Closed, deeply reviewed, and touched units give current-cycle substantive
coverage of 58/58 (100.0%). This is progress coverage, not a substitute for the
stricter closure count.

### Closed

- `agent`
- `cache`
- `channels`
- `chat`
- `config`
- `discovery`
- `embedding`
- `errors`
- `eval`
- `extensions`
- `fs`
- `index.ts`
- `issues`
- `knowledge`
- `markdown`
- `mdx`
- `metrics`
- `platform`
- `provider`
- `prompt`
- `registry`
- `release-assets`
- `repositories`
- `runs`
- `runtime`
- `sandbox`
- `schedule`
- `schemas`
- `studio`
- `task`
- `testing`
- `trigger`
- `types`
- `webhook`
- `version.ts`

### Deep reviewed, fixes pending

- `html`
- `resource`
- `utils`

### Touched, revalidation required

- `build`
- `client`
- `data`
- `integrations`
- `internal-agents`
- `mcp`
- `middleware`
- `modules`
- `oauth`
- `observability`
- `proxy`
- `react`
- `rendering`
- `routing`
- `security`
- `server`
- `skill`
- `tool`
- `transforms`
- `workflow`

### Pending current review

None.

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

The current closed review chain covers `agent`, `cache`, `channels`, `chat`, `config`,
`discovery`, `embedding`, `errors`, `eval`, `extensions`, `fs`, `issues`, `knowledge`,
`markdown`, `mdx`, `metrics`, `platform`, `provider`, `prompt`, `registry`,
`release-assets`, `repositories`, `runs`, `runtime`, `sandbox`, `schedule`,
`schemas`, `studio`, `task`, `trigger`, `types`, `webhook`, `index.ts`, and
`version.ts`.
The chain also covers `testing` after its portable assertions, BDD adapters,
process-global test helpers, timing, documentation, and direct consumers were
remediated and revalidated.
The latest Chat findings and the independent adversarial knowledge, Markdown,
MDX, provider, repositories, runs, runtime, and sandbox findings are remediated
and revalidated. `prompt` is closed after its cross-cutting registry, discovery,
HMR, request-lifecycle, and MCP findings were remediated and revalidated.
`registry` is closed after its scope lifecycle, request-generation isolation,
transaction invalidation, and cross-entry validation findings were remediated
and revalidated. `cache` is closed after its backend contracts, key identity
and invalidation, portability, request lifecycle, multi-tier coordination, and
dependency hashing findings were remediated and revalidated. `channels` is
closed after its signed-envelope, proxy trust, route identity, invoke lifecycle,
serialization, and consumer findings were remediated and revalidated. `fs` is
closed after its public facade, cross-runtime failure semantics, atomic
temporary allocation, path/cwd dependencies, package declarations, and direct
consumers were remediated and revalidated. `errors` is closed after its error
identity, throwable normalization, HTTP and CLI boundaries, retry semantics,
diagnostic redaction, cross-runtime compatibility, and direct consumer findings
were remediated and revalidated. `types` is closed after its shared server and
RSC contracts, runtime consumers, package surface, dependency direction, and
type-level regressions were remediated and revalidated.
`platform` is closed after its runtime registry, capabilities, local and hosted
adapters, filesystem, HTTP and WebSocket lifecycle, KV and cache behavior,
native compatibility, environment, process, path, test-support, public
contracts, and cross-runtime consumers were remediated and revalidated.
`trigger` is closed after its source discovery, canonical identity, bounded
input, deterministic duplicate handling, local task/workflow/agent execution,
cancellation, lifecycle, public surface, and direct consumers were remediated
and revalidated.
`schedule` is closed after its calendar grammar, data-only configuration
boundary, canonical definition ownership, integration requirements, local and
remote execution controls, public surface, documentation, and direct consumers
were remediated and revalidated.
`webhook` is closed after its data-only definition and payload boundaries,
hosted filter and prompt semantics, target-specific local execution, source
discovery, public surface, documentation, and direct consumers were remediated
and revalidated. The shared trigger and schedule discovery changes made during
that closure received complete affected-suite and repository-boundary
revalidation, so both previously closed units remain closed.
`discovery` is closed after its configuration and filesystem boundaries,
deterministic multi-root identity, export validation, registry generation
transactions, source-module and package-resolution caches, production startup
policy, documentation, and direct consumers were remediated and revalidated.
The narrow shared configuration and trigger changes received their complete
affected suites and repository-boundary checks, so `config` and `trigger`
remain closed.
`agent` is closed after its runtime-state, cancellation-authority, hosted
steering, project Skill I/O, child-resolution, tool lifecycle, public contract,
documentation, and complete top-level regression findings were remediated and
revalidated.
The root entrypoint unit is closed after its exact public and client-safe export
contracts, runtime dependency ownership, browser graph, rewrite target, Deno and
npm package surfaces, documentation, and built consumer declarations were
remediated and revalidated.
`resource` and `utils` have received deep current-state reviews and substantial
remediation. Resource remains open while its cache-policy breaking-change
decision is unresolved. Utils remains open while its future-lockfile,
malformed-import-map, and default-memoization compatibility decisions are
unresolved. Each closure requires a complete consumer map, deep module-level
review, adversarial boundary tests, public-contract documentation, and
repository-wide static verification.
`html` has completed its current implementation review and remediation. Its
focused, complete-module, browser, release-asset, and static gates pass. Formal
closure is pending only replacement of the materially stale module README with
an accurate reference document; the documentation workflow requires explicit
confirmation of that reference-only classification before authored content is
restructured.
Cross-module consumers changed by a fix remain in revalidation; focused
evidence for one boundary does not by itself close the consumer's top-level
unit. No unit now lacks a current authoritative-branch review delta; the next
dependency-ordered work closes the remaining reviewed unit and revalidates the
touched units.

### Proxy active checkpoint

The `proxy` audit unit has completed its implementation-level review and
non-policy remediation. It remains in revalidation rather than closed because
production behavior for missing OAuth client credentials is a breaking
deployment-policy decision: the current process warns and continues, while the
recommended policy is to reject missing credentials in production and retain
credential-free operation only in explicit development.

The current proxy findings are otherwise remediated:

- split and combined mode share one context-header implementation, including
  content-source identity, request cancellation, internal-header replacement,
  and bidirectional removal of standard and `Connection`-owned hop-by-hop
  headers;
- request Host authorities, upstream origins, API base paths, and origin-form
  paths are canonicalized without protocol-relative URL interpretation, and
  local filesystem projects are rejected in production;
- renderer retries and BFF API calls use bounded, request-linked cancellation;
  retry timers are cleaned up, late fetch responses are canceled, API redirects
  are rejected, and trace URLs exclude query strings;
- user cookies, OAuth project-miss classification, JWT provider lookup,
  decoded claims, cache-control directives, unknown thrown values, and error
  responses now have bounded fail-closed boundaries without prose scraping,
  stale extension caching, accessor execution, or unsafe coercion;
- shutdown health changes to `503 draining`; generated errors, redirects, API
  responses, health, statistics, and draining responses carry explicit
  non-cacheable/security headers; and obsolete duplicate environment access
  code was removed.

Reproducible checkpoint evidence:

- all 50 proxy suites pass 442 nested steps with zero failures;
- `deno task verify:quick` passes formatting, lint, dependency and module
  boundaries (zero cyclic edges), extension audits, all 740 documentation links,
  and repository-wide typechecking;
- `docs/architecture/02-request-pipeline.md` records the Host/header boundary,
  outbound deadline and cancellation model, BFF redirect and caching policy,
  authentication parsing, and shutdown health behavior.

### Task closure checkpoint

The `task` audit unit owns the public `veryfront/task` definition and execution
contracts, canonical project-runtime lookup, and the deprecated standalone
file-discovery compatibility path. Its direct dependencies are configuration,
discovery, errors, platform adapters, runs environment projection, utilities,
and the unified project-agent runtime. Direct production consumers are the
`veryfront task` CLI, local schedule/webhook trigger execution, control-plane
task execution, and the shared project discovery handler.

The current task findings are remediated:

- **Symptom -> Source -> Consequence -> Remedy:** values with a callable `run`
  but malformed names, descriptions, schemas, or scheduling metadata crossed
  discovery as `TaskDefinition`. The source was a guard that checked only one
  property. The consequence was runtime values that contradicted their typed
  contract and could poison CLI labels, API metadata, or downstream policy.
  The guard now validates every declared field without accepting arrays as
  schema records, while lookup helpers defensively fall back from blank names.
- **Symptom -> Source -> Consequence -> Remedy:** Windows paths, file URLs, and
  nested task paths produced environment-dependent IDs, while the canonical
  handler could turn a file outside its configured root into an absolute-like
  task ID. The source was literal slash and prefix slicing. The consequence was
  cross-platform ID drift and unsafe discovery identity. Both paths now reuse
  the discovery path normalizer; canonical discovery requires a safe relative
  path and task IDs retain nested `/` segments on every supported runtime.
- **Symptom -> Source -> Consequence -> Remedy:** legacy discovery and lookup
  depended on adapter directory order, and `sync.ts` plus `sync.js` silently
  selected or returned competing definitions. The source was unsorted walking,
  append-only results, and first-match lookup. The consequence was
  nondeterministic execution after filesystem or deployment changes. Legacy
  files and results are sorted, duplicate valid IDs are rejected with
  deterministic diagnostics, ambiguous lookup fails closed, and canonical task
  listings sort independently of map insertion order.
- **Symptom -> Source -> Consequence -> Remedy:** request cancellation stopped
  the HTTP lifecycle without reaching project task code, and duration used an
  adjustable wall clock. The source was an execution context with no signal and
  `Date.now()` subtraction. The consequence was avoidable work after caller
  cancellation and potentially negative or non-monotonic duration evidence.
  Task options and context now carry an optional cooperative `AbortSignal`;
  pre-aborted work never invokes user code; trigger and signed control-plane
  paths propagate their request signal; and durations are non-negative integer
  milliseconds from the monotonic performance clock.
- **Symptom -> Source -> Consequence -> Remedy:** the public guide omitted the
  environment and cancellation context, documented the wrong nested task ID,
  conflated canonical and legacy file extensions, and exposed no task-owned
  name for the unified runtime result. The source was documentation and type
  surface drift across several generations of discovery. The guide,
  architecture explanation, source README, generated API pages, and JSDoc now
  describe the actual contracts, and `ProjectTaskRuntimeDiscovery` gives the
  public entrypoint a task-owned result type.

Reproducible checkpoint evidence:

- Four focused task, discovery-handler, and control-plane test files passed 11
  suites and 66 nested steps with zero failures, including cancellation before
  invocation, trigger propagation, malformed metadata, cross-platform paths,
  duplicate IDs, runtime lookup, environment projection, and signed server
  execution.
- Six adjacent schedule and webhook suites passed 39 steps with zero failures.
- `deno task docs:validate` passed the executable guide portfolio and all 740
  documentation links.
- `deno task verify:quick` passed generated-manifest freshness, formatting of
  4,399 files, lint and policy ratchets, core/dependency/module boundaries with
  zero cyclic edges, extension audits, documentation validation, and every
  configured TypeScript entrypoint.
- `deno task typecheck:consumer` rebuilt the root npm package and all
  first-party extensions, verified root-import lifecycle behavior, and
  compiled the documented consumer composition against generated declarations.
  `git diff --check` also passed.

No unresolved critical or high-confidence production risk remains inside the
task definition, discovery, lookup, context, or execution boundary.
`schedulable` remains scheduling eligibility metadata; schedule admission,
timeouts, and enforcement belong to the still-open `schedule` and control-plane
units rather than being hidden inside the generic task runner. The `task` unit
is closed. Adjacent edits keep `discovery` and `server` in revalidation.

### Trigger closure checkpoint

The `trigger` audit unit owns the public `veryfront/trigger` contracts for
canonical target identity, shared schedule/webhook source discovery, and local
task, workflow, or agent execution. Its direct dependencies are configuration,
project discovery, structured errors, platform adapters, bounded JSON schemas,
the unified task runtime, the workflow client, and project agent/tool
registries. Direct production consumers are schedule and webhook discovery and
the local `veryfront schedule run` and `veryfront webhook run` command paths.

The current trigger findings are remediated:

- **Symptom -> Source -> Consequence -> Remedy:** empty path segments,
  traversal-shaped IDs, inherited fields, accessors, cycles, sparse arrays,
  custom serialization, and caller-owned mutable values could cross trigger
  admission. The source was a permissive ID regex, ordinary property reads,
  and a hand-written walk that validated without copying. The consequence was
  ambiguous target identity, caller-code execution during validation,
  post-validation mutation, and unbounded work. IDs now use bounded canonical
  slash-separated segments; targets use own data descriptors; and trigger,
  schedule, and webhook values become bounded data-only JSON snapshots with
  precise safe rejection paths before asynchronous work.
- **Symptom -> Source -> Consequence -> Remedy:** adapter order selected source
  order, the first duplicate ID won, one of several valid exports in a file was
  silently selected, and unsafe source directories reached the filesystem.
  The source was unsorted collection, incremental first-wins de-duplication,
  export-order selection, and no runtime directory boundary. The consequence
  was deployment-dependent behavior and configuration-driven path escape.
  Discovery now validates relative directories before adapter access, sorts
  paths and results by code unit, rejects every member of an ambiguous ID
  group, rejects distinct definitions in one file while accepting aliases of
  the same object, and copies definitions through their owning normalizers.
- **Symptom -> Source -> Consequence -> Remedy:** module-load errors could
  expose credentials or unbounded hostile throwable text. The source was
  direct `Error.message` or `String` coercion. The consequence was secret
  disclosure, accessor execution, or diagnostic resource abuse. Discovery now
  uses the shared bounded, credential-redacting throwable snapshot and emits
  stable structured errors in deterministic order.
- **Symptom -> Source -> Consequence -> Remedy:** malformed target kinds fell
  through to agent execution, local agent targets were reported as
  unsupported, malformed agent responses crossed the typed boundary, and task
  input could change while discovery yielded. The source was branch fallthrough,
  stale capability assumptions, trusted response property access, and late
  input consumption. The runner now snapshots and validates its target and
  inputs before yielding, executes every documented target kind, validates
  agent results through own data descriptors, and reports structured
  configuration, lookup, or execution failures.
- **Symptom -> Source -> Consequence -> Remedy:** cancellation did not
  consistently reach agents or workflows; workflow cancellation could leave
  an active run and a result-poll timer after the caller returned. The source
  was signal propagation limited to tasks plus a race against an
  uncancellable polling promise. The consequence was continued work, leaked
  timers, and unreliable shutdown evidence. Agents receive the caller signal;
  `WorkflowHandle.result(signal?)` cancels only its waiter without leaking its
  timer; and trigger failure or abort cancels and settles any active workflow
  before destroying the client. Simultaneous execution and cleanup failures
  retain both causes.
- **Symptom -> Source -> Consequence -> Remedy:** durations mixed target-local
  wall clocks, public exports lacked ownership tests and runtime guards, and
  docs/error guidance still described task/workflow-only execution. The
  consequence was non-monotonic evidence and contract drift. Total
  discovery-plus-execution duration now uses the monotonic clock and a
  non-negative integer result; an exact public-surface test owns every runtime
  export; JSDoc, generated references, architecture guidance, schedule
  concepts, and trigger error recovery text match current behavior.

Reproducible checkpoint evidence:

- Eleven trigger, workflow, schedule, webhook, discovery, schema, and error
  suites pass 198 nested steps with zero failures and with resource/operation
  sanitizers enabled, including adversarial IDs and values, caller-mutation
  isolation, same-file and cross-file ambiguity, redacted module failures,
  pre-abort behavior, agent response validation, workflow cancellation, and
  result-waiter timer cleanup.
- The broader error/schema and direct bounded-JSON consumer portfolio passes
  47 tests and 904 nested steps with zero behavioral failures. The four
  pre-existing typed fixture diagnostics remain confined to their already-open
  owners; production entrypoints typecheck in the repository gate.
- `deno task docs:validate` passes all 40 generated API pages, 66 published
  guides, 111 public documentation files, executable examples, and 744 links.
- `deno task verify:quick` passes manifest freshness, formatting of 4,401
  files, lint and policy ratchets, dependency and module boundaries with zero
  cyclic edges, extension audits, documentation validation, and every
  configured production entrypoint typecheck.
- `deno task typecheck:consumer` rebuilds the npm package and every first-party
  extension, reports zero npm vulnerabilities, verifies root-import
  lifecycle, and compiles the documented consumer composition against the
  generated declarations. `git diff --check` also passes.

No unresolved critical or high-confidence production risk remains inside the
trigger identity, source discovery, local execution, cancellation, or public
contract boundary. The narrow bounded-JSON diagnostic additions and trigger
error guidance were revalidated across `schemas` and `errors`, so those units
remain closed. The owning `schedule`, `webhook`, and `workflow` units remain in
top-level revalidation; their narrow normalization and result-waiter changes
are evidence for, but do not substitute for, their complete module reviews.

### Issues closure checkpoint

The `issues` audit unit owns the internal file-backed project issue contract:
strict runtime schemas, Markdown/frontmatter serialization, persistent ID
allocation, CRUD and list behavior, and the six issue MCP tools. Its direct
dependencies are the shared schema extension, structured errors, compatibility
path/process helpers, and the platform `FileSystem` abstraction. Its production
consumers are the `veryfront issues` CLI, the development MCP tool registry,
and the HTTP MCP `issues://` resources. `veryfront/issues` is a workspace import
but is not an npm export, so generated public API reference is intentionally
limited to the adjacent exported filesystem lines changed by this checkpoint.

The current issues findings are remediated:

- **Symptom -> Source -> Consequence -> Remedy:** traversal-shaped, oversized,
  unsafe-integer, and control-bearing IDs or project paths reached path
  construction. The source was a permissive ID regex plus validation after
  filesystem access. The consequence was path escape, ambiguous identity, and
  unbounded boundary work. IDs, prefixes, paths, text, collections, bodies,
  files, and list limits now use strict shared schemas before dependent work.
- **Symptom -> Source -> Consequence -> Remedy:** permission, corruption, and
  malformed-frontmatter failures appeared as missing issues. The source was
  broad catch-and-return behavior in get, list, and delete paths. The
  consequence was silent data loss and misleading automation. Only recognized
  not-found errors map to null, false, or an empty list; invalid files surface
  a structured 422 error and operational failures retain their causes.
- **Symptom -> Source -> Consequence -> Remedy:** issue files and storage
  directories could be symbolic links. The source was following `stat` and
  direct reads without terminal-link checks. The consequence was reading or
  mutating outside the intended project storage. Default adapters now use
  `lstat` for directories and files and fail closed on links or non-regular
  storage.
- **Symptom -> Source -> Consequence -> Remedy:** concurrent creates selected
  the same next ID, deleted IDs were reused, and empty reservation directories
  disappeared from Git. The source was scan-then-write allocation with no
  durable identity record. The consequence was overwrites and clone-dependent
  identity reuse. Atomic `.ids/<ID>` directory claims now contain a
  Git-trackable marker, successful and deleted IDs remain reserved, allocation
  is bounded, and failed reservations roll back with combined cleanup errors.
- **Symptom -> Source -> Consequence -> Remedy:** updates performed
  read-modify-write without cross-manager coordination and wrote directly over
  the live file. The source was same-instance assumptions and a filesystem
  abstraction without replacement support. The consequence was lost labels,
  partial files, and alias-dependent races. A fair same-storage queue plus
  atomic per-ID `.locks/<ID>` directories serializes mutations; default Deno
  and Node adapters expose same-filesystem rename; temporary writes replace
  the live file only after validation; every cleanup path preserves both the
  operation and cleanup error.
- **Symptom -> Source -> Consequence -> Remedy:** the hand-written YAML parser
  corrupted quoted strings and arrays, admitted unsupported structures and
  duplicate keys, created prototype-bearing objects, and trimmed meaningful
  body whitespace. The source was delimiter splitting and broad whitespace
  normalization. The consequence was non-round-tripping records and unsafe
  metadata interpretation. Parsing is now a documented, bounded flat YAML
  subset paired with canonical JSON-compatible string serialization, a
  null-prototype result, strict metadata validation, and exact removal of only
  the serializer's framing newlines.
- **Symptom -> Source -> Consequence -> Remedy:** `Date.parse`, lexical ID
  ordering, and unconditional rewrites made sub-millisecond ordering,
  zero-padded IDs, locale behavior, and no-op timestamps unstable. The source
  was lossy date conversion and locale-sensitive string comparison. The
  consequence was nondeterministic lists and false change history. ISO
  date-times receive calendar and offset validation and exact nanosecond
  comparison; ASCII IDs have numeric and code-unit tie ordering; no-op updates
  preserve the record; real updates advance monotonically and reject
  unrepresentable year overflow before writing.
- **Symptom -> Source -> Consequence -> Remedy:** CLI casts trusted arbitrary
  sort controls, an invalid numeric `--limit` became no limit, invalid
  states/prefixes could become no-ops, fields could not be cleared, and delete
  ignored JSON mode. The consequence was boundary-dependent behavior and
  scripting output drift. Explicit type guards and bounded numeric parsing now
  produce structured argument errors, empty edit values clear supported
  fields, not-found results are structured, and every JSON mutation has a
  stable machine-readable result.
- **Symptom -> Source -> Consequence -> Remedy:** MCP duplicated weaker schemas,
  silently ignored unsupported state values, advertised inaccurate idempotency,
  and exposed unbounded list/resource output counts. The consequence was drift
  between programmatic, CLI, and transport contracts. MCP now composes the
  canonical schemas, validates documented aliases, uses behavior-accurate
  annotations, applies the shared maximum count by default, and validates
  `issues://` item IDs before filesystem access. The HTTP resource server
  snapshots an explicit or construction-time project directory rather than
  consulting mutable process cwd for every request.
- **Symptom -> Source -> Consequence -> Remedy:** the CLI suite copied private
  helper implementations and asserted inert argument objects rather than
  invoking the command. The consequence was coverage that could remain green
  while command wiring regressed. Those tests were replaced with real create,
  list, edit, lifecycle, deletion, structured-error, clear-field, JSON, and
  invalid-boundary workflows; the MCP suite now executes every CRUD tool.

Reproducible checkpoint evidence:

- The direct core, schema, and MCP suites pass 66 tests and 38 nested steps
  with zero failures. They cover malformed storage, parser round trips,
  traversal, symlinks, allocation races, deleted-ID retention, atomic
  replacement failure, timestamp precision and overflow, lock contention,
  cleanup failure, and the complete MCP lifecycle.
- Direct `src/issues` coverage is 89.1 percent branches, 100 percent functions,
  and 88.5 percent lines. Core reaches 100 percent function coverage, and the
  MCP implementation reaches 96.9 percent line coverage.
- The expanded issue, CLI, filesystem-adapter, MCP registry, and HTTP resource
  set passes 76 tests and 156 nested steps with zero failures.
- Formatting, lint, direct typechecks, diff checks, generated documentation,
  46 executable documentation tests with 89 steps, and all 735 documentation
  links pass.
- `deno task verify:quick` passes generated manifests, formatting of the full
  source tree, lint and architecture ratchets, dependency and module
  boundaries, extension contracts, documentation validation, and every
  configured entrypoint typecheck.
- `deno task typecheck:consumer` rebuilds the npm package and every first-party
  extension, verifies root import lifecycle, and passes consumer composition
  against the generated declarations. A direct Node 24 smoke of the built
  public filesystem entry confirms rename replaces the target and removes the
  source.

No unresolved critical or high-confidence issues production risk remains. The
following bounded residuals are explicit:

| Severity | Surface                              | Evidence and consequence                                                                                                                                                                                                                                                | Required resolution                                                                                                                                                                      |
| -------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Moderate | Compatibility filesystem adapters    | Default Deno and Node adapters provide `lstat` and atomic rename. A caller-injected legacy `FileSystem` may omit either optional capability; that preserves the existing seam but cannot prove terminal-link safety and uses direct write replacement.                  | Make both capabilities mandatory through an explicit compatibility release, then remove the fallback and add third-party adapter conformance tests.                                      |
| Low      | Crash durability                     | Same-filesystem rename prevents partial visibility but the abstraction has no file or directory `fsync` contract. A host crash can therefore lose a recently acknowledged issue or reservation even though ordinary operation failures are handled.                     | Add an opt-in durable-write capability with platform tests before claiming power-loss durability.                                                                                        |
| Low      | Filesystem race window               | Terminal `lstat`, bounded read, and atomic replacement reduce link and partial-write risks, but path components can change between checks because the abstraction has no directory-handle or no-follow operation.                                                       | Evolve the platform layer around directory handles or equivalent no-follow primitives where supported; keep project issue storage within a trusted local workspace meanwhile.            |
| Low      | Stale mutation locks                 | A process crash can leave `.locks/<ID>` behind. Automatic age-based reaping could admit two writers, so mutations deliberately fail with 409 until an operator verifies no writer is active and removes only that lock.                                                 | Introduce owner tokens and a tested lease/heartbeat protocol before automating stale-lock recovery.                                                                                      |
| Low      | Large local collections              | Programmatic and CLI `list()` preserve the historical all-results behavior when no limit is supplied and must scan matching files to compute total and sort. MCP caps count at 1,000, but schema-valid bodies can still make a maximum response large.                  | Add cursor pagination and an explicit response-byte contract through a compatibility-reviewed API evolution.                                                                             |
| Low      | Distributed reservation coordination | A crash between atomic reservation-directory creation and marker writing leaves a locally reserved but untracked empty directory, and independent Git branches can still select the same uncommitted ID. The marker prevents reuse only after it is written and shared. | Use a durable centralized allocator when globally unique cross-branch identity is required; otherwise commit `.ids` markers with issue changes and resolve branch collisions explicitly. |

The `issues` unit is closed. Adjacent `platform`, CLI, MCP server, and generated
filesystem/testing reference changes passed their focused consumers but keep
those top-level audit units in revalidation.

### Repositories closure checkpoint

The `repositories` audit unit owns the internal filesystem and cache repository
contracts, their runtime schemas, project/content-source identity extraction,
repository factories, in-memory and multi-tier cache implementations, and
test doubles. Its direct dependencies are the platform filesystem adapter,
`SecureFs`, cache backends and the shared multi-tier cache, canonical content
source identity, the schema extension boundary, and structured framework
errors. Current source consumers use the repository interfaces in domain
lookup, RSC manifest handling, static-file resolution, and custom error-page
caching. The concrete factory and implementations are internally exported but
are not yet composed by a production runtime owner; that bounded residual is
recorded below rather than mistaken for end-to-end adoption.

The current repositories findings are remediated:

- **Symptom -> Source -> Consequence -> Remedy:** scoped keys could alias when
  identity or caller keys contained delimiters, and caller mutation could move
  a live repository into another namespace. The source was raw colon
  concatenation plus retained mutable context objects. The consequence was a
  credible cross-project read or invalidation boundary failure. Repository
  contexts are now validated, copied, frozen, and encoded into a versioned,
  length-bounded RFC 3986 key format whose variable components are injective.
- **Symptom -> Source -> Consequence -> Remedy:** memory entries expired one
  tick late, reads did not refresh recency, expired entries could evict live
  entries, and invalid capacities or TTLs were accepted. The source was an
  insertion-ordered `Map` used as an incomplete LRU with ad hoc TTL arithmetic.
  The consequence was stale reads, unstable eviction, and unbounded or
  nonsensical configuration. One shared expiring LRU now enforces the cache TTL
  contract, exact-boundary expiry, live-entry pruning, read/update recency, and
  positive safe capacity.
- **Symptom -> Source -> Consequence -> Remedy:** prefix deletion could race
  with a read backfill or point write, while a backend without pattern deletion
  silently reported success. The source was asynchronous backfill around two
  best-effort L1 wipes and optional backend mutation. The consequence was stale
  resurrection after `clear()` and false claims that a scope had been removed.
  A fair FIFO shared/exclusive operation gate now orders point operations
  against invalidation, backfill remains inside the shared permit, unsupported
  deletion fails closed, backend counts are validated, and defensive L1 wipes
  bracket partial backend failure.
- **Symptom -> Source -> Consequence -> Remedy:** repository construction could
  manufacture `"unknown"`/`"draft"` identities, or infer a production scope
  without its release. The source was permissive fallback logic in handler
  context extraction. The consequence was unrelated requests sharing a cache
  namespace. Enriched request identity is now authoritative; fallback
  extraction requires a stable project, explicit preview/production mode, and
  canonical content-source computation that rejects a missing production
  release.
- **Symptom -> Source -> Consequence -> Remedy:** filesystem repositories
  accepted byte arrays even though the underlying runtime contract only writes
  text, and an omitted or malformed security context became the broad
  `"internal"` policy. The source was lossy UTF-8 coercion, an optional wrapper
  option, and a permissive `SecureFs` switch default. The consequence was
  silent binary corruption and a fail-open path-policy downgrade. The contract
  is now explicitly text-only, security context is required and checked at
  runtime, and `SecureFs` owns one canonical context set that rejects unknown
  values during construction and context changes.
- **Symptom -> Source -> Consequence -> Remedy:** runtime constructors, schemas,
  and test doubles accepted different context, cache-name, TTL, filesystem, and
  statistics behavior. The source was duplicated validation and Map-based
  mocks that did not model expiry, byte sizes, parent directories, or recursive
  removal. The consequence was green tests for states production rejected, and
  false failures for states production supported. Shared constraints now drive
  schemas and runtime checks; the mocks snapshot identity, share TTL/LRU
  semantics, preserve byte/text ownership, and model the directory lifecycle
  and structured failure cases used by consumers.
- **Symptom -> Source -> Consequence -> Remedy:** the adjacent page-CSS cache
  used delimiter keys with shared `"default"`/`"draft"` fallbacks, and its
  injected async repository seam made a synchronous API silently miss while a
  fire-and-forget write raced teardown. The source was a test-only abstraction
  embedded in runtime code. The consequence was cross-project collision,
  nondeterministic tests, and unobserved write failures. The cache now uses a
  versioned JSON tuple with explicit project identity and a registered bounded
  LRU; the incoherent injection seam and the unused SSR-service repository
  option were removed.
- **Symptom -> Source -> Consequence -> Remedy:** three broad E2E groups encoded
  obsolete contracts: route code could override authoritative security
  headers, loaded skill assets were excluded from advertised support files,
  and proxy RSC tests lacked trusted routing identity and depended on live
  control-plane, filesystem, and event services. The consequence was a red
  broad suite that did not distinguish product regressions from stale fixtures.
  Assertions now match the authoritative header and skill contracts, while the
  RSC fixture supplies signed dispatch identity, UUID project/environment
  scopes, bounded offline API responses, and a lifecycle-safe event socket.
  Independent preview projects no longer reuse one tenant cache namespace.

Reproducible checkpoint evidence:

- The two direct repository test files passed eight suites and 74 steps with
  zero failures. Factory wiring and every filesystem repository operation are
  exercised, not only the underlying helpers.
- The repository, adjacent CSS/rendering/SSR, and canonical `SecureFs`
  regression set passed 13 suites and 205 steps with zero failures.
- Four direct server consumers passed four suites and 93 steps with zero
  failures: domain lookup, RSC manifest handling, static-file service, and
  custom error-page fallback.
- The shared cache-backend contract passed 84 tests, including TTL, pattern
  deletion, batch, byte-bound, API-auth, Redis scan, and fallback behavior.
- Scoped repositories coverage is 87.3 percent branches, 90.2 percent
  functions, and 87.5 percent lines. The concrete factory and filesystem
  implementation each reached 100 percent function and line coverage.
- The formerly failing response-header, skill-capability, and RSC hydration E2E
  groups passed together: three groups, 19 steps, zero failures. The final RSC
  fixture rerun passed all four browser scenarios with the unexpected-log guard
  enabled and no cache-corruption warning.
- `deno task verify:quick` passed generated-manifest freshness, formatting of
  4,286 files, lint and static policy ratchets, dependency and module
  boundaries, extension contracts, all 735 documentation links, public guide
  validation, and every configured TypeScript entrypoint.
- The 34-minute all-in-one test portfolio passed 3,500 tests and 28,258 steps,
  with one intentional test/36 steps ignored. It did not produce a green
  aggregate: three failed records across two timing surfaces occurred under
  sustained load, an RSC request crossing the 10-second slow-request guard and
  one starter dev server missing its readiness window. The exact RSC surface
  then passed one suite/three steps in 365 ms, and the complete starter-template
  smoke passed one suite/seven steps in seven seconds. This classifies the
  failures as load-sensitive verification flakes for this checkpoint; it does
  not claim that the repository-wide final production gate is green.

No unresolved critical or high-confidence repositories production risk remains.
The following bounded residuals are explicit:

| Severity | Surface                          | Evidence and consequence                                                                                                                                                                                                                                       | Required resolution                                                                                                                                                      |
| -------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Low      | Concrete repository composition  | Current production consumers import repository interfaces, but source search finds no runtime owner constructing `RepositoryFactory` or the concrete implementations. Unit and consumer gates can detect contract drift but cannot prove operational adoption. | Compose the layer through one production owner with end-to-end backend and filesystem tests, or remove the dormant abstraction through the normal compatibility process. |
| Low      | Mock filesystem fidelity         | The test double models text/byte ownership and directory failures but deliberately reports no symlinks and does not reproduce every platform metadata or ordering detail.                                                                                      | Keep traversal and symlink claims on real-adapter `SecureFs` tests; extend the mock only when a consumer contract genuinely requires additional fidelity.                |
| Low      | Aggregate-suite load sensitivity | The monolithic local run exceeded request/readiness timing guards after sustained compilation and server load, while both exact failures passed immediately in isolation.                                                                                      | Keep strict log guards; run the final broad gate on a stable runner or supported shards, and investigate if either exact surface repeats outside aggregate load.         |

The `repositories` unit is closed. Adjacent edits keep `rendering`, `security`,
`server`, `skill`, and their other top-level consumers in revalidation; this
checkpoint does not certify those complete units.

### Sandbox closure checkpoint

The `sandbox` audit unit owns the public eager and lazy sandbox clients, their
control-plane and runtime protocol boundaries, streaming command execution,
agent-service and shell-tool adapters, and sandbox-specific configuration and
lifecycle behavior. Direct consumers include hosted agents, internal-agent
execution, root sandbox tool sources, the sandbox shell extension, generated
API declarations, and the public sandbox guide.

The current sandbox findings are remediated:

- Configuration now fails closed. Explicit blank API URLs and tokens no longer
  fall back to ambient values; URLs, credentials, project references, timeouts,
  and polling intervals are bounded and validated before a request. One
  project-reference snapshot is used throughout each operation so an ambient
  project change cannot split one lifecycle across tenants.
- One shared transport layer now owns request deadlines through response-body
  consumption, caller-signal composition, redirect rejection, structured
  status and transport classification, bounded bodies, and fatal UTF-8
  decoding. Error details are bounded independently from successful JSON and
  file responses, and retry decisions no longer inspect runtime-specific error
  messages or operating-system codes.
- Control-plane responses, runtime endpoints, file metadata, session state,
  and command events cross explicit protocol parsers. Required fields,
  nullability, identifiers, enums, URLs, dense arrays, and own data properties
  are checked without invoking accessors. Runtime endpoint URLs reject
  credentials, queries, and fragments.
- Streaming command output is accumulated by bytes rather than JavaScript
  character count. Each newline-delimited JSON event has a fixed bound,
  decoding is strict, malformed and post-exit events cancel the reader, and
  every successful stream must contain exactly one terminal exit event.
- Request payloads are snapshotted into descriptor-safe owned data before
  network activity. Commands, environment entries, file names and contents,
  option shapes, and buffered output are bounded. Unsupported values, sparse or
  extended arrays, accessors, cycles, invalid UTF-8, and implicit object-to-text
  coercion fail closed instead of becoming partial or misleading requests.
- Eager and lazy lifecycle behavior now rejects work during or after close,
  makes successful close idempotent, surfaces deletion failures while keeping
  failed closes retryable, and prevents project-session deletion while a
  background command is active. Concurrent provisioning cannot silently reuse
  a sandbox created for a different project snapshot; custom internal
  endpoints pass readiness checks under one bounded provisioning budget.
- Shell-tool schemas retain the provider's actual command constraints.
  Provider-owned Standard Schema values are converted at the extension
  boundary, including the pinned `bash-tool` Zod schemas, and core accepts only
  bounded, descriptor-safe JSON Schema. Invalid, cyclic, accessor-backed, or
  unsupported definitions reject registration; the former permissive `{id}`
  fallback is removed.
- The How-to-oriented sandbox guide, architecture explanation, extension
  reference, generated API reference, and public option documentation now
  describe authentication, project snapshots, limits, deadlines, streaming
  guarantees, and lifecycle failures consistently.

Reproducible checkpoint evidence:

- The focused sandbox, shell-extension, and strict response-body suites passed
  26 tests and 140 nested checks with zero failures.
- Sixty-one downstream consumer tests, including hosted and internal agents,
  root/default sandbox tool sources, child-fork sources, and public boundary
  aliases, passed with zero failures.
- The repository suite passed 3,568 tests and 28,227 steps with zero failures;
  one 36-step group remains intentionally ignored under the repository
  baseline.
- `deno task verify:quick` passed generated-manifest checks, formatting, lint,
  sanitizer and skipped-test ratchets, dependency and module boundaries,
  extension audits, documentation validation, and all configured entrypoint
  typechecks. Core retained zero disallowed third-party imports.
- `deno task typecheck:consumer` rebuilt the root npm package and every
  first-party extension, verified root-import lifecycle behavior, and compiled
  the documented public composition surface against generated declarations.
- All 66 guides, 109 public documentation files, 38 generated reference groups,
  and 735 documentation links passed validation. The frozen lockfile was
  byte-for-byte stable across installation, the npm dependency audit reported
  zero vulnerabilities, and `git diff --check` passed.

The shared response-body utility and npm build metadata changed only to support
the sandbox boundary and remain assigned to the still-open `utils` and `build`
units. Hosted-agent and tool consumers remain in their existing revalidation
categories. No unresolved critical or high-confidence production risk remains
inside the sandbox client, protocol, transport, lifecycle, or tool-schema
boundary.

### MDX closure checkpoint

The `mdx` audit unit owns the public `veryfront/mdx` component-provider facade.
The first-party `ext-content-mdx` implementation and the build renderer are its
primary compilation consumers. The public facade now documents that it
composes application-owned React components and does not compile or sanitize
arbitrary source. Nested providers inherit outer entries, nearest overrides
win, and stable inputs retain a stable memoized component map.

The current MDX findings are remediated:

- Content parsing now has one explicit extension-owned boundary.
  `ContentProcessor.extractFrontmatter()` owns syntax-aware metadata parsing,
  while core retains dependency-free YAML extraction and safe merge helpers.
  The processor contract, cache identity, result-isolation promise, plugin
  tuple shape, module-value constraints, runtime choice, and output shapes are
  documented and present in generated declarations.
- YAML, supplied metadata, and parser-recognized static exports merge in a
  deterministic order. Static-export examples inside fences, comments, JSX,
  or expressions remain content. Malformed surrounding documents keep
  candidate exports intact so compilation reports the real syntax error.
  Accessors, enumerable symbols, and prototype-pollution keys cannot cross the
  metadata boundary unnoticed.
- Generated module bindings and exports accept only valid identifiers and
  finite, owned JSON data. Plain objects, dense arrays, data properties, and
  valid dates are normalized deterministically; cycles, accessors, symbols,
  sparse arrays, non-plain objects, non-finite numbers, duplicate
  binding/export names, authored-declaration collisions, and unsupported
  option keys fail closed before code generation.
- Import discovery now delegates to the registered `ModuleLexer` contract
  instead of regex matching or adding parser dependencies to core. Static
  imports, re-exports, literal dynamic imports, import attributes, query
  strings, and fragments retain their syntax and ordering; comments, examples,
  and ordinary strings cannot become false dependencies.
- Authored local imports resolve through an explicit project boundary.
  Extension inference is deterministic, explicit suffixes are not guessed a
  second time, root-relative and file URL paths are normalized, and both
  lexical traversal and symlinks escaping the canonical project directory are
  rejected before a module is emitted. Cyclic graphs terminate, failed child
  modules prevent parent emission, and dependency/output order is stable.
- A placeholder-shaped authored or replacement specifier could previously be
  rewritten into an unrelated HTTP URL. The source was a non-injective
  substring restoration step that confused internal lexer tokens with user
  text; the consequence was deterministic but incorrect module mutation.
  Placeholder restoration now requires an exact parsed-specifier match, and
  inserted literals escape token-shaped text before source unmasking.
  Regressions cover both lexer implementations and the MDX replacement path.
- Unified plugin tuples retain their parameters and list order. Plain Markdown
  accepts configured plugins but always runs the sanitizer after caller
  rehype transforms. MDX remains explicitly application-authored executable
  content rather than claiming an untrusted-input sandbox.
- Both build modes emit the portable React JSX runtime. This avoids mixing
  incompatible React runtime instances in one generated module graph; `mode`
  remains build context rather than an undocumented runtime selector.
- Parser dependencies are pinned to the content extension, excluded from the
  root npm package metadata, represented in the frozen lockfile, and absent
  from dependency-free core. The Reference-oriented extension README and API
  pages and the How-to-oriented pages-and-routing guide describe the actual
  provider, frontmatter, plugin, and generated-module contracts.

Reproducible checkpoint evidence:

- Eighteen focused MDX, Markdown, provider, lexer, import-rewriter, and build
  suites passed 240 checks with zero failures.
- The complete content extension surface passed eight suites and 113 checks
  with zero failures. The build-renderer integration passed 18 additional
  checks with zero failures.
- The repository suite passed 3,549 tests and 28,179 steps with zero failures;
  one 36-step group remains intentionally ignored under the repository
  baseline.
- `deno task verify:quick` passed formatting, lint, dependency and module
  boundaries, extension audits, documentation validation, and all configured
  entrypoint typechecks. Core retained zero disallowed third-party imports.
- `deno task typecheck:consumer` rebuilt the root package and every first-party
  extension, verified root import lifecycle behavior, and compiled documented
  MDX composition against the generated npm declarations.
- API-reference regeneration was byte-for-byte deterministic at 38 module
  groups and 3,471 of 3,726 documented public declarations. All 731
  documentation links passed.
- The frozen dependency install passed, `git diff --check` passed, and the npm
  audit found no vulnerabilities across 70 dependencies.

The generic build output-directory and output-collision policy, legacy
build/compiler and import helpers, and any future true React development
runtime ABI remain assigned to the still-open `build`, `transforms`, and
`react` units. They are not hidden by this closure, and the consumer modules
changed here remain in revalidation. No unresolved critical or
high-confidence production risk remains inside the MDX provider and content
processing boundary.

### Markdown closure checkpoint

The `markdown` unit owns the thin public `veryfront/markdown` facade and its
standalone Markdown rendering contract. The shared implementation lives in the
React component and code-surface modules; those changes are evidence for this
boundary but do not close the top-level `react` unit. The public contract is
`Markdown`, `MarkdownProps`, `CodeBlockProps`, `Components`, and
`PluggableList`: synchronous CommonMark/GFM rendering, consumer element and
fenced-code overrides, readonly trusted plugin lists, exact fence text, and
readable source before or after browser-only enhancement.

Runtime dependencies are React, `react-markdown` 9.0.3, `remark-gfm` 4.0.1,
Shiki 1.24.0, Mermaid 11.16.0, the strict trusted-HTML validator, package
generation, the browser import rewriter, and the standalone HTML-preview
enhancer. Direct consumers include chat message and reasoning surfaces,
`veryfront/chat`, `veryfront/ui`, the npm `veryfront/markdown` entrypoint,
generated API references, the chat UI guide, and both HTML-shell and
standalone-preview Markdown paths. Exercised runtime paths include semantic
SSR, hydration and progressive syntax highlighting, Mermaid rendering and
theme changes, custom components and plugins, Deno workspace resolution, npm
package emission, browser bare-import rewriting, SSR framework-module
rewriting, and CDN-backed standalone previews.

Material findings and remedies:

- **SSR semantics were conditional on a browser CDN effect.**

  Symptom: server output was a whitespace-preserving paragraph, while
  `react-markdown` and GFM loaded later in `useEffect`; a blocked or failed load
  left the downgrade permanent.

  Source: A Philosophy of Software Design - information leakage and shallow
  modules.

  Consequence: headings, lists, tables, links, and accessible document
  structure were absent from SSR, search output, and failure states despite the
  public API promising Markdown.

  Remedy: `src/react/components/chat/markdown.tsx` now uses package-owned static
  renderer and GFM imports through explicit Deno/npm workspace facades, so the
  semantic tree exists synchronously and browser dependencies enhance rather
  than define the content.

- **Fence parsing and fallback rendering corrupted authored source.**

  Symptom: the language regex accepted only `\w`, Shiki trimmed all code, and
  Mermaid loading or error states replaced source with a skeleton or error
  alone.

  Source: Code Complete - defensive programming and input-preservation
  discipline.

  Consequence: identifiers such as `c++`, indentation, leading or trailing
  blank lines, and failed diagram source could be lost or changed.

  Remedy: fence IDs are captured through the next whitespace boundary, only
  the parser-added final newline is removed, Shiki and plain rendering preserve
  the exact remaining text, and every Mermaid loading and failure path retains
  readable source.

- **Lazy dependency and Mermaid singleton state had unsafe lifecycle
  semantics.**

  Symptom: rejected module/highlighter promises could remain cached, concurrent
  theme renders could interleave `initialize` and `render`, and stale effects
  could publish output for superseded props.

  Source: Code Complete - explicit error paths and resource-lifecycle
  discipline; The Pragmatic Programmer - orthogonality.

  Consequence: one transient load failure could require a page reload,
  simultaneous diagrams could use the wrong theme, and fast prop changes could
  flash stale HTML.

  Remedy: retryable singleflight loaders, a failure-tolerant FIFO executor,
  serialized Mermaid configuration plus rendering, keyed result state, and
  effect cancellation now define the lifecycle. Focused tests cover
  coalescing, retry, failure recovery, serialization, source restoration, and
  forced theme overlap.

- **Mermaid version and security knowledge was duplicated across preview
  paths.**

  Symptom: React code, the HTML shell, and the standalone preview independently
  referenced 11.4.1, a major-only `mermaid@11`, or a separate configuration;
  the dependency audit inspected only `npm:` targets.

  Source: The Pragmatic Programmer - DRY as duplicated knowledge; A Philosophy
  of Software Design - information leakage.

  Consequence: previews could silently drift to an unreviewed release, retain
  known Mermaid vulnerabilities, race theme renders, or hide source after a
  partial failure while the audit still reported clean.

  Remedy: one exact package policy owns Mermaid 11.16.0 and esm.sh pin `v135`;
  both preview producers use one strict, serialized, source-restoring script;
  the audit now includes exact esm.sh manifest dependencies.

- **Package-owned imports were not deterministic at every transform
  boundary.**

  Symptom: unversioned browser imports defaulted to the latest esm.sh package,
  and the first full-suite run proved the new React-workspace facades lacked SSR
  re-export routing.

  Source: Software Engineering at Google - dependency management and upgrade
  blockage; Clean Architecture - dependency boundary integrity.

  Consequence: browser behavior could change without a source or lockfile
  change, while SSR could recursively reach workspace-only aliases and fail
  module linking.

  Remedy: the browser strategy pins all four framework-owned packages while
  preserving explicit application-authored versions; one URL registry also
  drives exact workspace URLs, React-facade SSR routing, config drift tests, and
  generated bundles. The routing drift guard covers every source facade under
  `react/`.

- **Published types and user guidance did not prove the real contract.**

  Symptom: no external npm consumer fixture compiled `veryfront/markdown`, and
  public guidance did not state SSR semantics, progressive fallback, plugin
  trust, unsafe-protocol behavior, remote-image requests, or caller-owned input
  limits.

  Source: Software Engineering at Google - Hyrum's Law and backward
  compatibility.

  Consequence: declaration regressions could ship unnoticed and users could
  infer safety or availability guarantees the implementation did not provide.

  Remedy: package metadata and DNT mappings now publish exact dependencies; a
  real React/TypeScript consumer fixture covers components, code renderers, and
  frozen plugin lists; JSDoc, generated reference pages, the module map, the
  how-to guide, and executable guide contracts now describe and exercise the
  boundary.

Reproducible checkpoint evidence:

- The final focused Markdown, code-runtime, HTML-preview, transform, package
  metadata, audit-parser, documentation, and drift-guard surface passed 50
  tests and 269 steps with zero failures.
- The repository suite passed 3,546 tests and 28,101 steps with zero failures;
  one unrelated intentional test remains ignored with 36 steps.
- `deno task verify:quick` passed manifest freshness, formatting, lint and
  policy ratchets, dependency and module boundaries, all documentation
  validation, and every configured entrypoint typecheck.
- `deno task typecheck:consumer` rebuilt the root npm package and every
  first-party extension, verified root-import lifecycle behavior, and compiled
  the published Markdown declarations through a real external React consumer.
- Documentation generation produced all 38 public module groups;
  `deno task docs:validate` passed the executable guide portfolio and all 731
  link checks.
- `deno task audit` found no vulnerabilities across 65 workspace npm
  dependencies. The rebuilt npm package also reported zero install
  vulnerabilities.
- Consecutive fresh `deno task generate` runs produced byte-identical client
  template, framework-candidate, and RSC bundle artifacts. `git diff --check`
  passed, and the final lock contains only the intended exact Markdown runtime
  releases rather than the prior Mermaid 11.4.1 or unreviewed target variants.

No unresolved critical or high-confidence Markdown production risk remains.
The following bounded residuals are explicit:

| Severity | Surface                       | Evidence and consequence                                                                                                                                                                           | Required resolution                                                                                                                        |
| -------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Low      | Remote Markdown images        | The default safe pipeline can still emit an ordinary remote `<img>` URL, causing the browser to contact that origin. This is documented and does not execute raw HTML.                             | Override the `img` component with an application allowlist, proxy, or placeholder when the content or privacy boundary requires it.        |
| Low      | Caller-owned document size    | The renderer preserves arbitrary input for API compatibility; it does not impose a universal byte or AST limit, so an application accepting unbounded hostile documents can consume CPU or memory. | Bound request and stored-document size at the application trust boundary according to its workload.                                        |
| Low      | Trusted extension points      | `remarkPlugins`, `rehypePlugins`, and custom components execute as application code and can intentionally weaken default URL or HTML behavior.                                                     | Keep plugin/component lists deployment-owned and review any safety-changing extension as code; never derive executable plugins from input. |
| Low      | Standalone preview CDN outage | A cold standalone preview still needs the exact audited esm.sh Mermaid module for SVG enhancement. Import failure leaves the original source untouched and readable.                               | Vendor the audited module if offline SVG enhancement becomes a product requirement; source readability already fails open safely.          |

The touched `build`, `html`, `react`, `server`, `transforms`, and `utils`
consumers remain in their own top-level revalidation categories. Closing
Markdown does not certify those broader units.

### Runs closure checkpoint

The `runs` unit owns the public canonical-runs HTTP client, durable-run and
event response schemas, and the internal environment-injection boundary shared
by local task and workflow execution. Its public contract is
`veryfront/runs`: `createRunsClient`, `VeryfrontRunsClient`, task/workflow/eval
creation, run listing/detail/events/cancellation, knowledge-ingest helpers, and
the exported request/response types and schemas. It depends on the cloud
bootstrap resolver, bounded retry transport, the schema adapter, shared opaque
identifier limits, and the bounded data-only JSON snapshotter. Direct
consumers are the task runner, workflow executor and worker hydration paths,
the executable runs guide, and generated package declarations. Runtime paths
cover explicit client configuration, request-scoped client derivation, cloud
bootstrap fallback, request serialization and retry, response parsing, task
context construction, and persisted workflow-context hydration.

Material findings and remedies:

- **Symptom:** Caller mutation, malformed targets and identifiers,
  contradictory runtime-target fields, invalid pagination, and cyclic or
  accessor-backed payloads could reach the retry boundary; legacy request
  setters also made one shared client unsafe across concurrent requests.
  **Source:** The client retained the caller's configuration object,
  interpolated request fields directly, and delegated validation to
  `JSON.stringify` or the remote API. **Consequence:** A request could change
  after admission, consume retries for a local error, or use another request's
  credential/project routing. **Remedy:** Construction now snapshots and
  validates URL, credential, project, and retry configuration; request
  identities, targets, counters, selections, and runtime-target tuples fail
  locally; request bodies are bounded data-only snapshots; and
  `withRequestContext()` creates an isolated client. The mutable setters remain
  deprecated only for source compatibility.
- **Symptom:** Structurally impossible or malformed API responses were accepted
  as canonical runs. **Source:** IDs and timestamps were unconstrained strings,
  counters and event IDs lacked integer/range checks, and runtime-target fields
  were parsed independently. **Consequence:** Invalid upstream state could
  propagate into scheduling, UI, or resume logic under trusted types.
  **Remedy:** Response schemas require non-empty identities, ISO datetimes,
  non-negative counters, non-negative integer event IDs, and coherent
  main-branch/environment/preview-branch tuples.
- **Symptom:** Platform and tenant secrets outside a small exact-name list could
  enter task or persisted workflow environment, while malformed injected JSON
  was silently treated as an empty environment. **Source:** Reserved-name
  filtering was case-sensitive and incomplete, and parse/type failures used a
  warn-and-continue fallback. **Consequence:** New framework credentials could
  leak without updating the list, and corrupt control-plane payloads could run
  tasks with silently missing configuration. **Remedy:** Every
  `VERYFRONT_*` and `TENANT_*` name is reserved case-insensitively, isolated-run
  identity names are withheld, and injected payloads have UTF-8 byte, entry,
  portable-name, string-value, and NUL checks. Malformed payloads fail before a
  task runs or a workflow resumes.
- **Symptom:** The broad production-mode suite exposed executable OAuth guide
  fixtures that depended on ambient token-store and application-URL fallback,
  while typed test checking revealed stale consumer shapes. **Source:** The
  examples omitted production-required dependencies and the typed-test
  grandfather list hid contracts already clean or newly corrected.
  **Consequence:** Parallel verification was environment-dependent and could
  miss declaration drift despite behavioral success. **Remedy:** Executable
  examples now inject a shared store and explicit origin, configuration suites
  use the environment-isolating BDD adapter, three stale typed fixtures were
  corrected, and the ratchet was reduced to 72 grandfathered files with zero
  new exceptions.

Reproducible closure evidence:

- The typed `src/runs` suite passes three suites and 29 steps, including
  construction snapshots, isolated contexts, malformed input, request
  mutation, response coherence, reserved namespaces, payload limits, and
  fail-closed injected environment behavior. `deno check src/runs/index.ts`
  passes.
- The typed task/workflow consumer surface passes four suites and 54 steps,
  including rejection before task invocation and failure before workflow
  resume.
- The executable guide surface passes 13 suites and 47 steps even under
  `DENO_ENV=production` with no ambient application URL.
- Generated references cover all 38 public reference groups; 65 guides and 108
  public documentation files validate, 45 executable/code-example suites pass
  87 steps, and all 723 documentation links resolve.
- `deno task verify:quick` passes manifests, formatting, lint, architecture and
  boundary ratchets, documentation validation, and every configured entrypoint
  typecheck. The typed-test ratchet reports 72 grandfathered files and zero new
  exceptions.
- `deno task typecheck:consumer` rebuilds the npm package and every first-party
  extension, verifies root import lifecycle, and passes consumer composition
  against generated declarations.
- `deno task test` passes 3,540 tests and 28,045 steps with zero failures; one
  intentional test with 36 steps remains ignored.

Residual risk is explicit and low: `setRequestToken()` and
`setProjectReference()` remain mutable for compatibility and must not be used
on a client shared across concurrent requests. They are deprecated and the
guide directs concurrent consumers to `withRequestContext()`. No unresolved
critical or high-confidence `runs` production risk remains.

### Knowledge closure checkpoint

The `knowledge` unit owns source-controlled project retrieval, local and hosted
OKF lookup, the `search_knowledge` tool, query normalization, and deterministic
prompt-context formatting. Its public contract is `veryfront/knowledge`:
`projectKnowledge`, `normalizeKnowledgeQuery`, `formatKnowledgeContext`,
`searchProjectKnowledge`, `createSearchKnowledgeTool`, and their configuration,
lookup, result, and RAG types. It depends on the embedding RAG store, tool
factory and schema contracts, bounded platform filesystem and path adapters,
request-scoped project context, the Veryfront API client, cloud URL resolution,
the shared error registry, and YAML compatibility parsing. Direct consumers
include discovery/runtime bootstrap, project-authored agents and tools,
executable RAG and ingestion guides, and generated package declarations.
Runtime paths cover explicit local indexing and retrieval, local manifest
traversal, request-scoped hosted release/environment/branch file listing,
cursor pagination, exact document lookup, and tool-mediated retrieval.

Material findings and remedies:

- **Symptom:** Malformed lookup inputs were validated after hosted I/O, while
  cursors, queries, file traversal, document content, frontmatter, hosted pages,
  and prompt context had incomplete or no resource budgets; several read and
  parse failures silently became empty metadata or browse results. **Source:**
  Admission, traversal, parsing, scoring, and response construction lived in
  one public module and relied on remote validation, string truncation, and
  catch-and-continue fallbacks. **Consequence:** Invalid callers could consume
  network, CPU, or memory; malformed knowledge could be treated as valid
  evidence; and large repositories or pagination loops could amplify work.
  **Remedy:** Public config, calls, cursors, queries, manifest traversal,
  document bytes, frontmatter shape, hosted pagination, result counts, and
  context bytes now have explicit validation and limits before dependent work.
  Invalid or unreadable knowledge fails closed, repeated or empty cursors are
  rejected, and hosted pages are validated incrementally before another page
  is requested.
- **Symptom:** Production hosted lookup could fall back to mutable `main` or a
  configured local directory, ignore `project_reference`, inherit request
  authority from an explicitly empty credential, and bypass the centralized
  API URL resolver. **Source:** Content-source selection and credential routing
  were inferred independently from optional fields. **Consequence:** A request
  could read content outside its immutable release or project authority, and
  deployment-specific API routing could drift from the rest of the platform.
  **Remedy:** Hosted project and credential identity is canonicalized from the
  trusted request context; production requires an immutable release or
  environment source, release wins when both are present, supplied project
  references must match the request scope, explicit empty credentials do not
  inherit authority, hosted context cannot fall through to local files, and
  API construction uses the central cloud resolver.
- **Symptom:** Non-Latin queries degraded to browse behavior, locale-dependent
  ordering changed pagination, scalar or sequence YAML roots could masquerade
  as empty metadata, nested metadata limits were ineffective, exact empty
  document content was omitted, and query text could be silently truncated.
  **Source:** ASCII tokenization, `localeCompare`, permissive shared
  frontmatter coercion, shallow metadata counting, truthiness checks, and
  implicit normalization encoded incompatible assumptions. **Consequence:**
  Search and pagination varied by language or runtime, invalid metadata hid
  authoring errors, and exact lookup results could misrepresent source
  content. **Remedy:** Search uses bounded Unicode normalization and tokens,
  sorting uses stable code-unit comparison, the knowledge boundary uses a
  strict mapping extractor while the shared compatibility extractor preserves
  its existing contract, nested metadata is snapshotted under depth/node/key
  budgets, empty content is retained, and overlong queries are rejected rather
  than shortened.
- **Symptom:** Construction retained caller-owned configuration, unknown and
  accessor-backed options were accepted, per-call RAG options were unbounded,
  and cancellation stopped only between hosted pages. **Source:** Configuration
  and option objects were read lazily, and abort signals were not propagated
  through the API transport and retry backoff. **Consequence:** Caller mutation
  could change admitted work, hostile accessors could execute inside lookup,
  and cancelled requests could continue consuming network or retry time.
  **Remedy:** Construction and call options are data-only validated snapshots;
  unknown keys and accessors fail before work; RAG counts, thresholds, and
  context output are bounded; and abort signals flow through search, retrieval,
  file listing, in-flight transport, attempt timeouts, and retry delay.
- **Symptom:** The public entrypoint mixed API contracts, RAG orchestration,
  hosted transport policy, filesystem traversal, parsing, scoring, and cursor
  machinery in one large implementation, while no goal-oriented knowledge
  guide described source authority or failure semantics. **Source:** Successive
  behavior was appended to `src/knowledge/index.ts` without an internal module
  boundary. **Consequence:** A local fix had a wide regression radius and users
  could mistake explicit browse mode for evidence-backed search. **Remedy:** The
  public facade now delegates to focused config, type, query, and lookup
  modules; the API surface remains source compatible; the new project-knowledge
  how-to and revised RAG/ingestion guides document immutable hosted sources,
  limits, cancellation, exact lookup, and explicit non-evidentiary browse mode.

Reproducible closure evidence:

- The knowledge suite passes two suites and 40 steps, including validation
  before I/O, canonical cursor enforcement, traversal and byte budgets, strict
  metadata, Unicode search, stable ordering, hosted authority, cancellation,
  configuration snapshots, and bounded prompt context.
- The strict-mapping compatibility repair and direct consumers pass six suites
  and 103 steps. Legacy frontmatter extraction retains its established
  body/attribute behavior, while knowledge rejects non-mapping roots.
- API transport cancellation passes six steps; API client operations pass 40
  steps; the affected error, frontmatter, API, discovery, and MDX consumer
  surfaces pass their focused regression suites.
- Documentation validation covers all 38 reference groups, 66 public guides,
  and 109 public documentation files. Forty-six executable/code-example suites
  pass 88 steps, and all 730 documentation links resolve.
- `deno task verify:quick` passes generated manifests, formatting, lint,
  architecture and boundary ratchets, documentation validation, and every
  configured entrypoint typecheck. The typed-test ratchet reports 71
  grandfathered files and zero new exceptions.
- `deno task typecheck:consumer` rebuilds the npm package and every first-party
  extension, verifies root import lifecycle, and passes consumer composition
  against generated declarations.
- `deno task test` passes 3,542 tests and 28,079 steps with zero failures; one
  intentional test with 36 steps remains ignored.

Residual risk is explicit and low. The shared API transport parses a trusted
Veryfront API JSON response before knowledge applies its per-page retained-data
budgets; a generic raw-response byte ceiling is a platform protocol decision
and remains for that unit's revalidation. Local files may grow between `stat`
and `read`, but the post-read byte check rejects the result before parsing or
retention. Browse results are deliberately exposed only with `mode: "browse"`
and are documented as navigation rather than evidence. No unresolved critical
or high-confidence `knowledge` production risk remains.

### Main integration checkpoint

The reviewed history was previously rebased onto `origin/main`. Subsequent
upstream synchronizations are merged from clean, pushed checkpoints because
replaying the recovered merge topology would force already-reviewed conflicts
across the complete recovery chain. An earlier synchronization retained two
independent layout-applicator imports in its sole conflict. The 2026-07-26
synchronization to v0.1.1152 merged cleanly and incorporated the upstream
fail-closed release-source convergence fix. Its focused deploy command,
integration, and MCP surface passed 16 tests and 75 steps, and
`deno task verify:quick` passed afterward. The first parallel repository run
then exposed an arbitrary 40-fake-tick ceiling in two new convergence tests:
one could observe 19 of the required 20 reads under scheduler load. Both tests
now drive fake time until the public read budget is observed, with a real
30-second test timeout guarding loss of progress. Four concurrent focused
stress runs and the complete parallel suite pass. The regenerated root lockfile
passes frozen resolution, generated manifests are current, and the repository
and consumer-package typecheck gates pass.

The later 2026-07-26 synchronization to v0.1.1153 was merged from the pushed
MDX checkpoint. Fifteen files required semantic resolution because the
recovered branch had independently hardened the same adapter, routing, config,
and discovery paths. The resolution retains source-qualified declarative
config evaluation, host-execution authorization, bounded route traversal,
strict operational-error propagation, transactional registry replacement, and
style-source revision guards while adding upstream's coalesced source
freshness lease, monotonic snapshot generations, generation-aware discovery
cache, page-before-API ownership check, and single-snapshot directory reads.
Focused adapter, routing, config, discovery, and entity coverage passed 30
suites and 551 steps with zero failures. `deno task verify:quick` passed, and
the complete post-merge repository suite passed 3,549 tests and 28,210 steps
with zero failures; one 36-step group remains intentionally ignored.

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

### Prompt closure and resource remediation checkpoint

The Prompt audit unit owns prompt construction and validation, interpolation
and generated content, project-scoped registration, discovery identity, MCP
exposure, and its published types and guidance. Its cross-cutting consumers
include discovery, request-time project runtimes, development HMR, hosted
streaming, the MCP server, starter agents, and the package build. The current
Prompt findings are remediated:

- Prompt configs require exactly one usable content source at runtime and in
  the public contract. Validation no longer depends on prior schema-extension
  bootstrap, configs and MCP metadata are snapshotted, duplicate argument names
  fail deterministically, generated IDs use captured time primitives, and a
  generator must resolve to text.
- Static interpolation reads only caller-owned properties through captured
  primitives and preserves input verbatim. The mutable blacklist that implied
  a security boundary was removed.
- Generators accept an additive, immutable cancellation context with an abort
  signal and absolute deadline. Pre-aborted work, in-flight cancellation,
  expired and non-finite deadlines, generators that ignore cancellation, and
  timers beyond the platform delay limit have deterministic behavior and
  cleanup.
- MCP prompt metadata now declares title and string arguments, required and
  unknown arguments are enforced, `mcp.enabled: false` is private, cancellation
  reaches rendering, generator failures remain undisclosed, and initialization
  advertises only capabilities implemented by the built-in Streamable HTTP
  transport. Custom transports retain explicit notification hooks and own
  their capability negotiation.
- Package-facing Agent, Prompt, Resource, Skill, Tool, and Workflow registries
  expose only current-scope operations. Shared registration, process-wide
  reset, and cross-scope aggregate access moved behind internal facades used by
  framework owners; runtime and generated-package fixtures prove project code
  cannot recover those capabilities.
- Finalized AsyncLocalStorage descendants receive a credential-free revoked
  sentinel and cannot fall back to the default registry scope. An explicitly
  returned streaming response leases its exact request context until the body
  closes, errors, or is cancelled, preserving legitimate hosted work without
  reopening detached access.
- Prompt discovery derives collision-free IDs from safe relative nested paths,
  preserves explicit IDs, treats named index re-exports as aliases, reports
  invalid exports and real duplicates as structured errors, and excludes
  directory-agent capability subtrees from the agent-definition pass.
- Request-time discovery, startup discovery, and HMR use one strict atomic
  project-primitive replacement. A generation containing errors rolls back to
  the last complete registry state, retries remain possible, configured
  discovery roots also drive file watching, and HMR never publishes a partial
  generation. One-shot agent and task runtimes preserve their documented
  tolerant mode by explicitly publishing the valid subset as one atomic
  generation and returning every structured error; strict task callers reject
  that same result.
- Resource patterns retain one validated grammar for registration, lookup,
  parameter extraction, and URI-template rendering. Raw query and fragment
  delimiters cannot alias into path parameters, exact URI identity is
  preserved, raw template braces are rejected, and patterns and requested URIs
  have explicit whitespace, control-character, and length bounds.
- Factory and literal definitions cross one strict, immutable registration
  boundary. Loader and subscription functions, schemas, and MCP metadata are
  captured before caller mutation; literal definitions receive the same schema
  validation and transforms as factory definitions; discovery metadata
  replacement does not apply non-idempotent transforms twice.
- Resource loaders receive an immutable read context with the exact URI and
  cooperative cancellation signal. Pre-aborted work does not start, pending
  loaders cancel promptly even when they ignore the signal, and MCP
  cancellation remains scoped to the originating foreground request.
- MCP hides disabled resources, separates resources from templates, and does
  not advertise unsupported subscriptions. JSON remains the bounded default;
  explicit text and blob modes enforce their declared MIME type and loader
  result, every final transport payload is byte-bounded at four megabytes, and
  binary bytes are snapshotted before base64 encoding.
- The Prompt concept page, MCP how-to, Resource explanation, README transport
  wording, generated API reference, and published-package consumer fixtures
  match the implemented contracts.

Reproducible evidence for this checkpoint:

- The complete changed-test surface passes 122 test groups and 566 nested steps
  with zero failures. This includes prompt and registry contracts, MCP
  protocol behavior, discovery/HMR rollback, hosted streaming lifecycle,
  request-scope revocation, and all changed cross-module consumers.
- A complete default-parallel repository run reached 3,666 passing tests and
  28,399 passing nested steps, with one intentionally ignored 36-step group.
  It exposed two deterministic task-discovery compatibility failures, which
  are fixed and pass with the atomic replacement regression suite (2 suites,
  24 steps). Its seven other failures were load-threshold and readiness guards
  under host saturation; all affected files pass sequentially in 8 suites and
  53 steps, including the blast-radius, production server, RSC, template,
  static-asset, and renderer performance coverage.
- The request-context lease tests run with operation and resource sanitizers
  enabled and cover body completion, cancellation, and failure. The discovery
  rollback test also runs without a sanitizer exemption.
- `deno task docs` regenerates all 38 public API groups. The documentation gate
  validates 109 public files, executable guide contracts and examples, and all
  736 links.
- `deno task verify:quick` passes generated manifests, formatting, lint and
  architecture ratchets, dependency and module boundaries, extension
  contracts, documentation validation, and every configured source and browser
  entrypoint typecheck.
- `deno task typecheck:consumer` rebuilds the npm package and every first-party
  extension, verifies root import lifecycle, and passes external TypeScript
  composition against the emitted Prompt, Resource, Skill, and Tool registry
  declarations.
- The current Resource-focused surface passes 24 test groups and 337 nested
  steps with zero failures, including registry, factory, schema, MCP,
  discovery, dashboard, request-time rediscovery, and OpenAPI consumers.
- After the Resource transport remediation, `deno task verify:quick` passes
  generated manifests, formatting, lint and architecture ratchets, docs and
  all 736 links, guide examples, and every configured source and browser
  entrypoint typecheck.

The `prompt` unit is closed. Adjacent `agent`, `cache`, `discovery`, `mcp`,
`platform`, `registry`, `resource`, `server`, `skill`, `tool`, and `workflow`
units remain in their stricter ledger states because focused Prompt closure
does not substitute for a full top-level review of those consumers.

The following findings keep `resource` in
`Deep reviewed, fixes pending`:

- Resource `mcp.cachePolicy` remains a reserved but unenforced setting. Cache
  key, TTL, invalidation, and failure semantics require a deliberate API
  decision; no behavior was invented for an existing no-op knob.

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
- `deno task test` passed 3,540 tests and 28,031 steps with zero failures; one
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
- The current repository suite passed 3,540 tests and 28,031 steps with zero
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

### Studio closure checkpoint

The `studio` audit unit owns four related internal contracts: the bounded
renderer/Studio `postMessage` protocol and schemas, server-side element
identity injection, the iframe bridge runtime, and the generated browser
artifact served by the Studio handler. Its production consumers are the HTML
rendering orchestrator, authored-HTML injection, Markdown preview generation,
the runtime handler chain, and the Veryfront Studio iframe. It has no public
root npm export. The current Studio consumer was inspected to distinguish live
protocol behavior from obsolete bridge fields and no-op actions.

The current Studio findings are remediated:

- **Symptom -> Source -> Consequence -> Remedy:** runtime config, schemas, and
  the current Studio consumer disagreed about nullable selection and retained
  obsolete direct-Yjs, provider, layout, and no-op action fields. The source
  was parallel hand-written contracts with no consumer reconciliation. The
  consequence was rejected selection clears and compatibility claims for
  behavior the bridge did not implement. The live nullable selection contract
  is now shared and tested; retired fields and actions fail explicitly; HTML
  emitters send only the supported project, page, path, nonce, and source-hash
  state.
- **Symptom -> Source -> Consequence -> Remedy:** an unvalidated first message
  could establish the parent origin, startup messages used permissive delivery,
  and caller-owned or oversized values entered an unbounded queue. The source
  was origin capture before parsing plus direct `postMessage` forwarding. The
  consequence was confused-deputy delivery, mutable queued state, memory
  pressure, and lifecycle reordering. The bridge now authenticates the parent
  source and exact hosted/localhost origin, validates before committing the
  session, snapshots side-effect-free bounded data, applies byte/count/action
  budgets, preserves critical ordering, coalesces superseded state, and never
  broadcasts with `*`.
- **Symptom -> Source -> Consequence -> Remedy:** selector injection missed
  authored full documents, treated markup-shaped text as tags, rewrote raw
  text and plaintext content, accepted unsafe options, and could collide with
  authored identities. The source was regex-oriented scanning and assumptions
  about fragment-only HTML. The consequence was an empty or corrupt Navigator
  and selectors that did not resolve to one element. A quote-aware,
  comment/raw-text-aware lexical scanner now preserves malformed input, limits
  work to the real `#root` subtree, respects ignored subtrees and authored
  ownership, validates bounded data-only options, and allocates collision-free
  identifiers. The shared nonce rewriter now uses the same offset-safe
  primitives, including Unicode and streamed split-tag regressions.
- **Symptom -> Source -> Consequence -> Remedy:** Navigator traversal,
  attributes, text, mutation streams, and generated identities were
  effectively unbounded and unstable across remounts. The source was recursive
  DOM walking, broad collection scans, and selector interpolation. The
  consequence was stack/memory pressure, identity drift, stale overlays, and
  unsafe selector evaluation. Iterative depth/node/collection budgets,
  exact-attribute lookup, canonical session identities, bounded mutation work,
  remount reconciliation, ignored-subtree pruning, and explicit disposal now
  preserve a schema-valid tree and release retained DOM references.
- **Symptom -> Source -> Consequence -> Remedy:** console and runtime-error
  forwarding invoked getters, serialization hooks, and coercion while leaking
  credentials, URL metadata, and local paths. The source was
  `JSON.stringify`, `String`, and raw browser diagnostics at the trust
  boundary. The consequence was attacker-controlled side effects, secret
  disclosure, and unbounded protocol output. Descriptor-based bounded
  formatting now treats arbitrary objects as opaque, contains proxies and
  cycles, redacts nested and repeatedly encoded credential names, sanitizes
  source paths, and installs/restores only bridge-owned wrappers and listeners.
- **Symptom -> Source -> Consequence -> Remedy:** screenshot capture fetched a
  mutable CDN script at runtime, trusted ambient globals, had no aggregate
  dimension/data/deadline limits, and could leave scrolling or timed-out work
  active. The consequence was CSP and supply-chain failure, memory exhaustion,
  overlapping captures, and corrupted viewport state. The renderer is pinned
  and embedded from an isolated browser workspace/SBOM boundary; core remains
  third-party-free. Capture now uses one absolute deadline, bounded dimensions,
  pixels, sections and PNG bytes, asynchronous encoding with cancellation,
  exclusive scroll ownership, quarantine for uncooperative timed-out work, and
  deterministic generic failures.
- **Symptom -> Source -> Consequence -> Remedy:** the bridge handler depended
  on the process working directory, rebuilt immutable production output,
  accepted incomplete cache validators, and leaked build diagnostics. The
  source was request-local source discovery and ad hoc response handling. The
  consequence was packaged-runtime failure, unnecessary subprocess work,
  incorrect 304 responses, and disclosure of local details. Packaged and
  production requests now serve the bounded checked-in artifact; only local
  non-production source mode rebuilds, concurrent builds coalesce, failures
  retry cleanly, GET/HEAD and RFC-compatible weak validators are handled
  explicitly, and errors return a generic no-sniff JavaScript response.
- **Symptom -> Source -> Consequence -> Remedy:** initialization and tests left
  listeners, overlays, observers, timers, console wrappers, browser subprocess
  pipes, and esbuild services without awaited ownership. The source was
  one-way setup and asynchronous cleanup hidden behind sanitizer opt-outs. The
  consequence was duplicate lifecycle messages, BFCache drift, hanging builds,
  and green tests that suppressed resource leaks. Initialization/disposal is
  idempotent and activation-aware; owned resources are removed in reverse
  order; the release bundler stops its service in `finally`; Chromium closure
  awaits its Node bridge, pipes, reads, and process with sanitizers enabled.
- **Symptom -> Source -> Consequence -> Remedy:** the checked-in bundle could
  drift from source and an unused Studio type facade duplicated constants and
  schema exports. The consequence was source/prebuilt behavior divergence and
  dead compatibility surface. One cwd-independent entry now drives release
  and local builds, deterministic regeneration is verified, source-mode output
  is compared byte-for-byte with release output, and the unused facade was
  removed.

Reproducible checkpoint evidence:

- The complete Studio, handler, HTML, rendering, Markdown-preview, logger, and
  Playwright-helper regression surface passed 99 suites and 411 steps with zero
  failures.
- Direct `src/studio` coverage is 83.4 percent branches, 96.5 percent
  functions, and 84.3 percent lines. Boundary tests include hostile accessors
  and proxies, oversized/deep payloads and DOMs, queue floods, timeouts,
  cancellation, lifecycle teardown, remounts, malformed HTML, and source-path
  redaction.
- A real Chromium iframe established the trusted parent session, emitted only
  schema-valid lifecycle state, captured a PNG through the embedded renderer,
  made no external dependency request, produced no browser diagnostic, and
  closed with Deno resource and operation sanitizers enabled.
- Two independent prebundle runs produced the same generated artifact:
  SHA-256
  `568a36a21bf53c2d4665387f17d87401d2e9425daf6c5c131c94a7627153448a`.
  The JavaScript payload is 512,448 characters, below its 4 MiB limit, and
  contains no mutable CDN reference, unresolved npm/JSR specifier, module
  import/export, or local filesystem path.
- Local source-mode output is byte-identical to the release builder and is
  independent of the caller's working directory. The prebuilt loader,
  in-flight build coalescing, retry behavior, GET/HEAD responses, strong/weak
  ETags, malformed validators, and sanitized failure response are covered.
- `deno task verify:quick` passed generated-manifest checks, formatting, root
  and browser lint, style and test ratchets, core/dependency/module/extension
  boundaries, documentation validation with all 736 links, the full root
  typecheck, and the browser workspace typecheck.
- The architecture support matrix and browser-boundary README document
  dependency ownership and packaged-runtime behavior. The core and CLI SBOM
  boundaries both remain at zero third-party npm components.

No unresolved critical or high-confidence Studio production risk remains.
One bounded third-party limitation is explicit: cross-origin or browser-unsafe
page assets can make canvas capture fail. The bridge returns a correlated,
schema-valid generic failure, restores owned scroll state, and does not fall
back to a remote script or ambient renderer; changing remote asset policy
requires a separate product and security decision.

### Chat closure checkpoint

The `chat` audit unit owns the canonical chat message and metadata contracts,
AG-UI decoding, provider-history conversion and preparation, terminal fallback
recovery, provider-error classification, stream watchdog, and upload route.
Its production consumers are the hosted Agent stream/runtime, React chat hooks
and components, the root `veryfront/chat` entrypoint, and the focused
`veryfront/chat/ag-ui`, `veryfront/chat/message-prep`, `veryfront/chat/types`,
and `veryfront/chat/uploads` exports. Its direct non-UI dependencies are the
schema extension, bounded JSON and timer utilities, platform media/runtime
helpers, integration summaries, and workflow blob adapters. Browser-facing
helpers retain leaf imports and the public React barrel remains isolated from
server upload dependencies.

The current Chat findings are remediated:

- **Symptom -> Source -> Consequence -> Remedy:** upload authorization was
  permissive when omitted or when a callback returned a non-boolean value, and
  multipart bodies were materialized before applying a file limit. The
  consequence was an accidental unauthenticated route and memory use above the
  advertised limit. Construction now requires an explicit auth policy,
  authorization succeeds only on literal `true`, request and file bytes are
  independently bounded before parsing, aborts propagate, malformed or
  multi-file bodies fail with stable client errors, and custom storage IDs,
  metadata, and URLs are validated before exposure. The approved fail-closed
  behavior and migration are documented in the Chat UI guide.
- **Symptom -> Source -> Consequence -> Remedy:** streamed reasoning could leak
  lifecycle fragments when disabled, CRLF boundaries split across network
  chunks were corrupted, permissive SSE IDs advanced replay state, and decoder
  frame/tool maps grew without a terminal bound. The consequence was protocol
  drift, duplicate suppression errors, and retained attacker-controlled state.
  Hosted mapping now suppresses the complete reasoning lifecycle; the AG-UI
  decoder preserves split CRLF, accepts only canonical non-negative integer
  IDs, bounds complete and incomplete frames, validates initial state, and
  releases tool and reasoning state on results and terminal events.
- **Symptom -> Source -> Consequence -> Remedy:** one active tool overwrote
  another in the watchdog, long-running exemptions could mask a parallel
  ordinary tool, keep-alives discarded tool phase, and oversized timer values
  were silently clamped by hosts. Parallel tool state is now explicit,
  ordinary tools retain timeout priority, matching outputs remove only their
  own state, keep-alives preserve active work, disposal is final, and every
  delay uses the shared portable timer-domain validator.
- **Symptom -> Source -> Consequence -> Remedy:** provider history accepted
  unknown, malformed, and role-incompatible parts; tool-result repair could
  move a reused call ID across a later user turn; cyclic or accessor-backed
  values could break conversion; and invalid usage/cost numbers survived
  normalization. Provider messages now use role-aware structural filtering,
  repair stops at user/system boundaries, JSON normalization is bounded,
  accessor-free and cycle-safe, metadata schemas and normalizers agree on
  non-negative integer token counts and finite costs, and uploaded file
  identity survives UI/provider conversion.
- **Symptom -> Source -> Consequence -> Remedy:** knowledge citations trusted
  prefix-only paths, serialized numeric tool results omitted exponent grammar,
  final-step promises accepted non-portable timeouts, and decorated or deeply
  nested provider errors could be missed or overflow the stack. Citations now
  require bounded canonical knowledge paths including decoded-segment checks;
  serialized results accept the complete JSON number grammar; fallback timers
  use the shared bounds; and error parsing has bounded text, candidate, and
  recursion budgets while still extracting balanced JSON from decorated logs.
- **Symptom -> Source -> Consequence -> Remedy:** public upload identity,
  decoder limits, and parallel watchdog state were not fully reflected in
  protocol types and generated reference material. Canonical types now expose
  filenames, sizes, upload IDs, decoder frame configuration, and active tool
  state; runtime export tests cover the barrel; the how-to guide and generated
  API reference were refreshed without mixing instructional and reference
  content.

Reproducible checkpoint evidence:

- The complete `src/chat` suite passes 58 tests and 151 nested steps with zero
  failures under coverage.
- Direct `src/chat` coverage is 82.8 percent branches, 94.1 percent functions,
  and 80.5 percent lines.
- The affected Agent/React boundary set passes 15 suites and 151 nested steps
  with zero failures, including hosted request/runtime, AG-UI encoding, stream
  finalization, runtime message adaptation, upload persistence, and controlled
  Chat rendering.
- Chat composability and antipattern ratchets pass, and all 39 migration
  codemod tests pass.
- `deno task verify:quick` passes generated manifests, full formatting and
  lint, sanitizer/skipped-test baselines, core/dependency/module boundaries,
  extension contracts, all documentation validators and 736 links, every root
  entrypoint typecheck, and the isolated Studio browser typecheck.

No unresolved critical or high-confidence Chat production risk remains.
Cross-module Agent and React files exercised or adjusted by this checkpoint
remain correctly listed as touched units until their own top-level
revalidation.

### Registry closure checkpoint

The `registry` audit unit owns the internal project-scoped registry manager and
facade used by Agent, Tool, Skill, Prompt, Resource, Workflow, model-provider,
and embedding-provider registries. Its transaction consumer is project
discovery replacement; its production scope owners are the hosted request
context and bounded Veryfront filesystem adapter manager. Registry remains an
internal deep module with no root npm export.

The current Registry findings are remediated:

- **Symptom -> Source -> Consequence -> Remedy:** project invalidation compared
  raw project prefixes with percent-encoded canonical scope identifiers. The
  consequence was stale discovery and registrations for delimiter-bearing
  project IDs. Scope construction is now centralized, discovery records retain
  exact project identity, and invalidation uses exact identity and canonical
  encoded matching.
- **Symptom -> Source -> Consequence -> Remedy:** registry scope maps outlived
  the bounded adapter that owned their source generation. The consequence was
  process-lifetime retention of superseded release and source registries.
  Adapter disposal now retires its exact registry scope after active leases
  drain, while authoritative project invalidation retires every matching
  scope. Project-wide retirement continues across listener failures and
  reports collected cleanup errors only after every known scope is attempted.
- **Symptom -> Source -> Consequence -> Remedy:** mutating a shared map during
  retirement would change registry visibility inside an active request. The
  consequence was generation mixing and non-repeatable request behavior.
  Request contexts now bind an opaque owner to an immutable registry
  generation; retirement detaches that generation, new requests observe the
  replacement, stale writes remain isolated, and finalization releases the
  owner binding.
- **Symptom -> Source -> Consequence -> Remedy:** a project or scope could be
  invalidated while its discovery transaction was still running. The
  consequence was a late commit resurrecting invalidated definitions.
  Authoritative cleanup now invalidates matching active transactions and
  prevents their publication.
- **Symptom -> Source -> Consequence -> Remedy:** shared registrations bypassed
  manager conflict validation, and per-registration checks could not validate
  a transaction against concurrently published entries. The consequence was
  inconsistent conflict behavior and ambiguous Resource patterns after a
  valid-looking transaction committed. Shared and scoped candidates now use
  the same configured validator, complete effective shared-plus-scoped
  transaction state is validated before publication, every live scope is
  checked before shared publication, and Resource supplies a deterministic
  whole-registry overlap validator.
- **Symptom -> Source -> Consequence -> Remedy:** clearing and rebuilding a
  registry inside one request initially targeted only its detached snapshot.
  The consequence was a replacement invisible to later requests. Clearing the
  current generation now resets that request's binding before registration;
  clearing from a stale request remains fenced from the current generation.

Reproducible checkpoint evidence:

- Six regressions reproduced the original adapter-eviction, encoded-project
  invalidation, shared-validation, active-request snapshot, transaction
  invalidation, and concurrent Resource-overlap failures before remediation.
  Further regressions cover the clear-and-rebuild publication defect and a
  concurrent shared-versus-scoped Resource overlap found during verification,
  plus complete multi-scope retirement when one lifecycle listener fails.
- The four directly changed suites pass 6 tests and 163 nested steps with zero
  failures.
- The expanded Cache, request-context, adapter, Registry, discovery, Agent,
  Tool, Skill, Prompt, Resource, Workflow, provider, and embedding boundary set
  passes 35 tests and 448 nested steps with zero failures.
- The complete unit suite passes 3,223 tests and 24,658 nested steps with zero
  failures; its one ignored test and five ignored nested steps match the
  repository baseline.
- `deno task verify:quick` passes generated manifests, formatting and lint,
  sanitizer and skipped-test baselines, architecture boundaries,
  documentation validation with all 736 links, every configured root
  entrypoint typecheck, and the isolated Studio browser typecheck.

No unresolved critical or high-confidence Registry production risk remains.
Manual internal callers that establish an explicit cache-key scope without a
hosted request context do not receive request-generation snapshots or adapter
eviction; they retain the existing explicit `clear` and `clearProject`
ownership contract. This path is not a public Registry API and does not affect
the hosted production lifecycle.

### Cache closure checkpoint

The `cache` audit unit owns cache-key and source identity, backend contracts,
memory/disk/Redis/API implementations, portable code storage, request-local
batching, multi-tier coordination, module caches, dependency hashing, and the
cache registry/invalidation facade. Its consumers span Build, Transforms,
Rendering, Platform adapters, Server request handling, project discovery, and
the React/MDX module loaders. `#veryfront/cache` is an internal workspace
surface rather than a published npm subpath, so this checkpoint updates the
internal contract and hardening ledger rather than public API guides.

The current Cache findings are remediated:

- **Symptom -> Source -> Consequence -> Remedy:** batch-capable backends and
  wrappers accepted arrays of unrelated size and delegated them inconsistently.
  The consequence was unbounded fan-out, oversized network calls, and a caller
  receiving different limits depending on the selected backend. One shared
  100-item policy now validates Memory, Redis, API, tokenizing-gateway, and
  multi-tier get/set batch boundaries before authentication, lookup, or
  mutation.
- **Symptom -> Source -> Consequence -> Remedy:** the batch-entry schema
  required positive integer TTLs while runtime backends accept finite
  fractional TTLs and define non-positive TTL as immediate expiry. The
  consequence was valid runtime operations being rejected at schema boundaries
  and out-of-range values reaching backend-specific handling. The schema now
  follows the shared finite maximum and immediate-expiry contract, with direct
  parity tests.
- **Symptom -> Source -> Consequence -> Remedy:** URI encoding rejected lone
  UTF-16 surrogates while byte encoders could collapse distinct malformed
  strings onto the replacement character. Render ownership parsing also used a
  different decoder from key construction. The consequence was exceptions,
  cache identity aliases, and missed project/source invalidation. A total,
  injective percent-segment codec preserves every JavaScript string, its
  decoder accepts only canonical emitted forms, and registry scopes, source
  identities, render keys, parsers, and Redis ownership use that single codec.
- **Symptom -> Source -> Consequence -> Remedy:** project, environment, and
  content-source invalidation partly interpreted structured render keys as raw
  colon-separated text. The consequence was stale render entries for encoded
  or delimiter-bearing identities. Every structured render ownership path now
  decodes the canonical segments and matches the exact requested source; opaque
  namespaces remain deliberately excluded rather than guessed.
- **Symptom -> Source -> Consequence -> Remedy:** API-cache availability used
  hostname substrings, successful JSON bodies were read without a byte bound,
  and malformed UTF-16 keys could reach network operations that could never be
  addressed by the GET URL. The consequence was remote hosts being
  misclassified as local, unbounded response memory, and write-only cache
  entries. URL parsing now classifies exact loopback/development hosts,
  configurable bounded fatal-UTF-8 reads replace `response.json()`, and all
  keys/project references are bounded and URI-valid before network I/O. The
  normal backend factory exposes the response limit.
- **Symptom -> Source -> Consequence -> Remedy:** a verified control-plane
  cache credential was stored directly in AsyncLocalStorage, so detached async
  descendants retained authority after the request callback settled. Streaming
  work had no explicit ownership signal. The consequence was a request
  credential lifetime extending beyond its verified operation. Credential
  scopes now hold revocable state; ordinary completion clears the capability;
  the agent-stream handler explicitly leases it to the returned response body;
  and close, error, or cancellation releases the lease. Detached descendants
  observe no credential after settlement.
- **Symptom -> Source -> Consequence -> Remedy:** Redis batch writes used
  fail-fast `Promise.all`. The consequence was the caller observing failure
  while sibling writes were still mutating Redis. Batch writes now await every
  sibling with `allSettled` and report the first failure only after the batch
  reaches a stable terminal state.
- **Symptom -> Source -> Consequence -> Remedy:** request-batching
  AsyncLocalStorage retained a live cache, timers, and backend state in
  detached descendants after the request returned. The consequence was
  cross-lifecycle memory retention and late mutation of finished request state.
  Request completion now drains queued work, closes the state, releases its
  collections, and makes inherited descendants fail closed.
- **Symptom -> Source -> Consequence -> Remedy:** an explicit multi-tier write
  could finish between an initial miss and computation publication, after its
  generation state had been pruned. Local sibling writes could also reject
  before all tiers settled. The consequence was stale computed data
  overwriting a newer value and callers returning while local mutation
  continued. The initial lookup retains its generation through the decision,
  stale computations re-read after the queued mutation, and local writes settle
  completely before failure is reported.
- **Symptom -> Source -> Consequence -> Remedy:** concurrent parents awaiting
  one deduplicated dependency read each charged the shared source bytes after
  the promise resolved. The consequence was valid dependency graphs falsely
  exceeding the aggregate source budget. The first continuation now records
  and charges shared content; later waiters re-check the prefetched map before
  accounting it.
- **Symptom -> Source -> Consequence -> Remedy:** Map-compatible iteration over
  the module LRU implemented `values()` and `entries()` through recency-mutating
  `get()` calls. The consequence was observation changing later eviction
  order. Iterators now traverse the LRU entries directly, leaving recency
  unchanged.
- **Symptom -> Source -> Consequence -> Remedy:** authored code containing the
  internal `file://__VF_CACHE_DIR__` marker survived tokenization and was later
  rewritten to a machine-local path. The consequence was silent source
  corruption and possible resolution of an unintended local cache artifact.
  Distributed tokenization now treats that exact protocol marker as reserved
  input and rejects it before storage; ordinary text mentioning the marker
  without the `file://` protocol remains valid.

Reproducible checkpoint evidence:

- The complete `src/cache` suite passes 137 tests and 586 nested steps with zero
  failures, including disk corruption/symlink/capacity invariants, backend
  contract tests, key and invalidation identity, request lifecycle, dependency
  graphs, multi-tier races, portability, and credential lease close/error/cancel
  paths.
- The complete internal agent-stream handler suite passes with the leased
  verified credential boundary, including successful streaming, cancellation,
  waiting/resume, exact source selection, and failure responses.
- The complete unit baseline passes 3,231 tests and 24,676 nested steps with
  zero failures; its one ignored test and five ignored nested steps match the
  repository baseline.
- `deno task verify:quick` passes generated manifests, formatting and lint,
  sanitizer/skipped-test baselines, architecture and extension boundaries,
  documentation validation with all 736 links, every configured root
  entrypoint typecheck, and the isolated Studio browser typecheck.
- `deno task typecheck:consumer` rebuilds the npm package and every extension,
  then passes the documented consumer composition typecheck against the
  generated declarations.

No unresolved critical or high-confidence Cache production risk remains.
Read-through cache misses and explicitly configured asynchronous backfills
remain availability-oriented by design: they are observable through logs and
statistics but do not replace authoritative source failures. Mutation,
identity, invalidation, credential, and lifecycle boundaries fail closed.

### Channels closure checkpoint

The `channels` audit unit owns signed control-plane envelopes, agent discovery
metadata, Slack invoke wire schemas, conversation-history adaptation, invoke
response normalization, and persistent-agent invocation isolation. Its direct
dependencies are Agent runtime contracts, the shared schema and JSON snapshot
primitives, structured errors, Skill discovery, project discovery, and Server
handler context. Its production consumers are the internal agents-list,
stream/resume/cancel/execute and channel-invoke handlers, proxy trust and
routing invalidation, public agent metadata/list routes, runtime context/config
classification, and Agent service routes. Both `veryfront/channels/control-plane`
and `veryfront/channels/invoke` are published npm subpaths, so additive API
controls preserve existing call signatures while the architecture explanation
documents the strengthened runtime contract.

The current Channels findings are remediated:

- **Symptom -> Source -> Consequence -> Remedy:** alternate base64url encodings
  of a valid Ed25519 signature verified, compact JWS parts and PEM input were
  unbounded, fractional/unsafe freshness policies were accepted, and
  attacker-controlled header/claim JSON was parsed before authenticity was
  established. The consequence was a documented canonicality mismatch,
  avoidable pre-authentication work, and inconsistent timestamp policy.
  Verification now bounds every envelope component, requires the exact
  canonical 64-byte Ed25519 encoding, validates safe-integer time policy,
  verifies raw signing input before JSON parsing, and reuses one rotation-safe
  imported-key cache.
- **Symptom -> Source -> Consequence -> Remedy:** an authentic proxy request
  failed when the optional schema-extension registry was not initialized. The
  source was a lazy high-level schema dependency inside the cryptographic
  verifier, even though proxy authentication runs before extension setup. The
  consequence was a hidden bootstrap-order dependency at a fail-closed trust
  boundary that could reject valid service traffic. Protected headers and both
  claim families now use one bounded, exact, dependency-free JSON object parser
  after signature verification; body-bound and authenticity-only verification
  therefore enforce the same contract without consulting optional extensions.
- **Symptom -> Source -> Consequence -> Remedy:** the proxy carried a second,
  weaker control-plane JWS implementation, and either signature family could
  unlock either internal route family before downstream rejection. The
  consequence was crypto/claims behavior drifting across trust boundaries and
  a dispatch token granting the wrong pre-renderer privilege. One audited
  signature/freshness implementation now serves both claim families, and the
  proxy selects the dispatch family only for `/channels/invoke` and the
  control-plane family only for its corresponding routes. Downstream
  body/audience/project authorization remains mandatory.
- **Symptom -> Source -> Consequence -> Remedy:** config-optional run routing
  compiled regexes per request and accepted arbitrary, percent-encoded, dotted,
  or oversized path segments that the runtime run-ID schema rejected. The
  consequence was middleware/config behavior disagreeing with the eventual
  handler contract. Precompiled path classifiers now validate the captured
  segment against the shared canonical run-ID schema.
- **Symptom -> Source -> Consequence -> Remedy:** several signed consumers
  parsed JSON and complex schemas before checking the body-bound signature.
  The consequence was unauthenticated payloads driving avoidable protocol work
  and inconsistent error precedence. Agent-list, stream, and execute consumers
  now verify the capped raw body first, then parse and explicitly bind body
  fields to the authenticated subject/project/surface; malformed path decoding
  also fails as a controlled request error.
- **Symptom -> Source -> Consequence -> Remedy:** project-discovery failures
  escaped `executeChannelInvoke`, request cancellation never reached generation,
  and a persistent agent had an unbounded promise tail. The consequence was
  handler-level rejection instead of the documented structured response,
  abandoned work continuing after disconnect, and unbounded retained payloads
  behind a slow stateful agent. Discovery and execution share one structured
  failure boundary, the handler forwards its abort signal, stateful work uses a
  32-operation fail-fast queue, cancelled queued operations never execute, and
  queue state is released after every terminal path.
- **Symptom -> Source -> Consequence -> Remedy:** duplicate persisted tool-call
  IDs could rebind a later result, duplicate runtime calls were emitted twice,
  and cyclic/accessor/prototype-bearing or oversized tool data could reach
  `Response.json`. The consequence was ambiguous tool history and late
  serialization failures outside the invoke error contract. Duplicate
  identities now retain the first unambiguous binding, tool and metadata values
  cross a bounded data-only snapshot, response messages/parts/tool calls have
  cardinality guards, and the complete response is snapshotted before schema
  publication.
- **Symptom -> Source -> Consequence -> Remedy:** the public agent-list handler
  used locale-sensitive name-only ordering while the signed list used stable
  code-point name-and-ID ordering. The consequence was platform-dependent
  output and insertion-order drift for equal names. Both consumers now use one
  exported deterministic comparator, and missing-agent diagnostics bound the
  IDs they place in logs.

Reproducible checkpoint evidence:

- The complete `src/channels` suite passes 5 tests and 78 nested steps with zero
  failures, including canonical envelope, route identity, history ambiguity,
  JSON safety, queue saturation, cancellation, discovery failure, and response
  normalization regressions.
- The signed handler, proxy, routing-invalidation, and control-plane-auth matrix
  passes 9 suites and 112 nested steps with zero failures, including the
  complete large agent-stream and project-run-execute suites.
- The complete proxy-handler suite passes 1 suite and 55 nested steps with zero
  failures, including valid signed traffic after the extension registry has
  been reset.
- The public agent, runtime-context/config, Agent service-route, and AG-UI
  fixture matrix passes 15 suites and 79 nested steps with zero failures.
- The deterministic complete unit baseline
  (`DENO_JOBS=1 deno task test:unit`) passes 3,231 tests and 24,690 nested steps
  with zero failures; the existing one test and five nested steps remain
  explicitly ignored. The single-job baseline is recorded because still-open
  CLI/testing consumers contain process-global current-directory tests that
  can make the default multi-worker runner itself exit nondeterministically.
  This checkpoint also makes the touched root-entrypoint subprocess independent
  of process-global current-directory changes.
- `deno task docs`, `deno task docs:validate`, and
  `deno task docs:coverage` generate 39 API-reference pages, validate 739
  internal links, and account for all 3,967 published source links. The
  Channels parent reference is generated and generator-regression tested.
- `deno task typecheck:consumer` rebuilds the npm package and every extension,
  then passes the documented consumer composition typecheck against the
  generated declarations.

No unresolved critical or high-confidence Channels production risk remains.
The proxy's pre-renderer check deliberately establishes signature authenticity
and freshness without consuming the streaming request body; every handler still
performs authoritative body, audience, project, subject, and scoped-claim
binding before acting. Proxy and Server consumer units changed here remain
listed for their own top-level revalidation.

### FS closure checkpoint

The `fs` audit unit owns the intentionally narrow `veryfront/fs` public facade:
runtime-neutral text and directory operations, canonical path helpers, current
working-directory inspection, the `FileSystem` type, and construction of the
runtime-native filesystem implementation. The implementation dependency is the
Platform compatibility layer. Direct production consumers are CLI sync,
deployment-provenance and server-startup boundaries, generated integration and
coding-agent templates, discovery transpilation, and lockfile persistence. The
facade is a published Deno and npm subpath; runtime exports, generated
declarations, and the built Node artifact are therefore part of the contract.

The current FS findings are remediated:

- **Symptom -> Source -> Consequence -> Remedy:** Node temporary-directory
  prefixes accepted path separators and parent traversal, allocation used only
  eight UUID characters, and recursive `mkdir` treated a pre-existing candidate
  as success. The source was manual path composition plus non-exclusive
  creation instead of the operating system's temp primitive. The consequence
  was allocation outside the temp root and reuse of an attacker-precreated
  directory for sensitive intermediate files. Both runtimes now accept only a
  basename prefix, reject invalid input through the promised asynchronous
  boundary, and Node uses atomic `mkdtemp` beneath the OS temp root.
- **Symptom -> Source -> Consequence -> Remedy:** `chmod` reported success for
  missing paths, permission denial, and arbitrary I/O failures. The source was
  a broad catch intended to tolerate limited Windows chmod support. The
  consequence was credential stores and other callers believing restrictive
  permissions had been applied when no change occurred. Only explicit
  unsupported-operation errors on Windows remain compatibility no-ops; every
  operational failure now rejects on Deno, Node, and Bun.
- **Symptom -> Source -> Consequence -> Remedy:** recursive removal rejected a
  missing path on Deno but silently succeeded on Node. The source was coupling
  Node's `force` option to the unrelated `recursive` flag. The consequence was
  runtime-dependent control flow and hidden stale or misidentified cleanup
  targets. Node now keeps `force` disabled, matching the public fail-closed
  contract; callers that intentionally tolerate absence use
  `isNotFoundError`.
- **Symptom -> Source -> Consequence -> Remedy:** the public-barrel test checked
  runtime names but did not prove the `FileSystem` type or its non-barrel
  capabilities survived packaging, while the npm smoke covered only happy-path
  helpers. The consequence was a green Deno facade despite Node-only security
  and failure-semantic regressions. The barrel now typechecks and instantiates
  the public contract, and the built-package smoke adversarially exercises
  chmod, recursive removal, prefix traversal, and pre-existing temp-directory
  collisions.

Reproducible checkpoint evidence:

- The regression-first Deno test failed because `chmod` resolved for a missing
  path. The pre-fix built Node smoke then failed all three added checks for
  chmod failure propagation, path-bearing temp prefixes, and collision reuse.
- The public facade, filesystem implementation, path/cwd dependencies, runtime
  integration, auth stores, deployment provenance, ignore handling, discovery
  transpilation, and lockfile consumer matrix passes 23 suites and 412 nested
  steps with zero failures.
- The deterministic complete unit baseline
  (`DENO_JOBS=1 deno task test:unit`) passes 3,231 tests and 24,693 nested steps
  with zero failures; the existing one test and five nested steps remain
  explicitly ignored.
- `deno task build:npm` rebuilds the root package and every extension. The
  resulting Node package passes 90/90 runtime smoke checks, including all new FS
  assertions, and the npm export-map verifier passes all 68 public paths.
- `deno task docs` and `deno task docs:coverage` generate 39 reference pages
  and account for all 3,967 published source links. The `veryfront/fs`
  reference now states the fail-closed removal, existence, and error contracts.
- `deno task verify:quick` passes manifest freshness, formatting, lint and
  architecture ratchets, all 739 documentation links and guide contracts, and
  every configured source and browser entrypoint typecheck.

No unresolved critical or high-confidence FS production risk remains. Platform
remains listed for its own top-level review because it owns the broader
compatibility layer beyond the narrow filesystem, path, and cwd surface
validated here.

### Types closure checkpoint

The `types` audit unit owns shared compile-time contracts for rendering,
request handling, HMR, RSC, bundling, modules, and the small type surface
re-exported by the root package. Its consumers span rendering, routing, server,
client, build, and runtime code. It is a foundation unit: type-only references
may describe higher-level integration contracts, but eager runtime behavior
must not make the shared type layer initialize or depend on those higher
layers.

The current Types findings are remediated:

- **Symptom -> Source -> Consequence -> Remedy:** the shared `RouteHandler`
  contract advertised route parameters as `string | string[]`, while both
  application-route execution paths normalize every parameter to a string.
  The source was drift between an older generic route shape and the actual
  server and route-executor boundaries. The consequence was that valid handlers
  could not use the runtime's string contract without casts, while impossible
  array branches appeared supported. The contract now uses
  `Record<string, string>`, and a compile-time regression exercises a handler
  against the normalized runtime shape.
- **Symptom -> Source -> Consequence -> Remedy:** `RSCRendererOptions` required
  a mutable `Map` even though renderer construction only reads and snapshots
  the client manifest. The source was exposing the implementation container
  rather than the operation the renderer requires. The consequence was
  needless mutation authority and rejection of immutable manifest views. The
  option now accepts `ReadonlyMap`, with a compile-time and runtime contract
  regression.
- **Symptom -> Source -> Consequence -> Remedy:** the foundation Types module
  contained a 1,033-line entity resolver with filesystem, routing, telemetry,
  error, and YAML behavior. The source was placing runtime entity discovery
  beside the entity interfaces it consumes. The consequence was inverted layer
  ownership and a shared-type path that initialized higher-level production
  dependencies. Entity resolution now lives in `rendering`, its only production
  owner, all consumers and tests use that location, and the architecture
  ratchet rejects any future eager runtime import from `src/types` into another
  top-level module.

No published Deno or npm subpath was removed by the relocation: the old entity
resolver path was internal-only. The handler correction aligns the declared
contract with both existing execution paths, and accepting `ReadonlyMap` is a
backward-compatible widening. Rendering remains listed for its own top-level
revalidation because it now owns entity resolution.

Reproducible checkpoint evidence:

- Before remediation, the new contract check rejected a normalized handler and
  a read-only RSC manifest. The new architecture regression independently
  reported all twelve eager edges from the Types entity resolver into higher
  layers.
- The complete Types suite, entity-resolution regressions, and direct
  page/layout consumers pass 13 suites and 163 nested steps with zero failures.
- The wider RSC, route-execution, cross-adapter, and layout integration matrix
  passes 9 suites and 217 nested steps with zero failures.
- The repository script suite passes 71 tests and 156 nested steps with zero
  failures, including the new dependency-direction regression.
- The deterministic complete unit baseline
  (`DENO_JOBS=1 deno task test:unit`) passes 3,231 tests and 24,693 nested steps
  with zero failures; the existing one test and five nested steps remain
  explicitly ignored.
- The module-boundary ratchet passes with no forbidden Types layer imports and
  no growth beyond the existing broad-import and cycle baselines.
- `deno task docs` and `deno task docs:coverage` generate all 39 API-reference
  pages and account for all 3,967 published source links.
- `deno task build:npm` rebuilds the root package and every extension. All
  68 npm export paths and 90 Node runtime smoke checks pass, and the external
  consumer typecheck accepts the generated declarations.
- `deno task verify:quick` passes manifest freshness, formatting, lint and
  architecture ratchets, all 739 documentation links and guide contracts, and
  every configured source and browser entrypoint typecheck.

No unresolved critical or high-confidence Types production risk remains.

### Utils review checkpoint

The `utils` audit unit owns the published `veryfront/utils` foundation surface
and its internal runtime helpers: logging and redaction, bounded caches,
concurrency primitives, environment and lockfile loading, hashing and IDs,
bundle-manifest persistence, memory diagnostics, path and response helpers,
runtime detection, and shared constants. Its consumers span nearly every
top-level unit, so the review covered public contracts, browser/server
separation, timer and memory domains, error semantics, lifecycle cleanup,
dependency direction, and the directly affected MDX, rendering, cache, and
module-loader integrations.

The current non-breaking Utils findings are remediated:

- **Symptom -> Source -> Consequence -> Remedy:** file, environment, import-map,
  lockfile, and remote-module helpers accepted unbounded or partially parsed
  input. The source was trusting upstream size checks and permissive numeric or
  structural parsing. The consequence was memory amplification, traversal
  through environment mode names, corrupt cached state, and truthy
  authorization callbacks bypassing fail-closed intent. Fixed character,
  entry, dependency, timer, and response budgets now apply before expensive
  work; parsing is complete and atomic; URL policy accepts only literal
  `true`; failed mutations restore the previous in-memory state.
- **Symptom -> Source -> Consequence -> Remedy:** queue, singleflight, named
  semaphore, circuit-breaker, and worker-pool registries could grow without a
  finite admission boundary, and `parallelMap` rejected while sibling work from
  the same call continued in the background. The source was unbounded defaults
  and `Promise.all` early rejection. The consequence was process memory growth,
  cross-request work after caller settlement, and configuration aliasing.
  Registries and queues now have validated finite budgets, same-key followers
  retain singleflight semantics, breaker configuration is identity-safe, and
  parallel workers settle as one structured operation before the first
  observed error is rethrown.
- **Symptom -> Source -> Consequence -> Remedy:** the in-memory bundle manifest
  bounded only entry counts and accepted malformed runtime values or incomplete
  replacement stores. The source was count-only LRU enforcement and
  compile-time interface trust. The consequence was tens of gigabytes of
  retained code/metadata, corrupt aggregate statistics, dangling reverse
  indexes, and late failures after a global store swap. Configurable aggregate
  UTF-8 budgets, bounded metadata snapshots, exact code-byte accounting,
  transactional replacement, coordinated index eviction, saturated statistics,
  and structural store validation now fail before global state changes.
- **Symptom -> Source -> Consequence -> Remedy:** cache and timer utilities
  mixed incompatible clock domains, accepted JavaScript timer overflow, or
  silently clamped invalid thresholds. The consequence was premature expiry,
  hot-loop timers, misleading memory alerts, and hard-to-reproduce cache
  behavior. TTL arithmetic now uses one clock domain, timer inputs are
  normalized against the portable runtime maximum, profiler thresholds are
  parsed as one coherent pair, and invalid programmatic thresholds reject
  instead of being rewritten.
- **Symptom -> Source -> Consequence -> Remedy:** lower-level Utils code owned
  CDN policy and reached upward through a logger trace bridge, while generated
  framework-source classification omitted current modules. The consequence was
  inverted dependency ownership, initialization coupling, and incomplete
  source-boundary decisions. CDN ownership moved to the correct constants
  layer, tracing now registers through the logger's lower-level hook, the
  bridge was removed, and framework-source classification derives from the
  complete current module set.
- **Symptom -> Source -> Consequence -> Remedy:** request IDs, generated IDs,
  layout cache identities, Redis delays, terminal line-width scans, and memory
  cache telemetry trusted values that were ambiguous, oversized, or unsafe to
  aggregate. The consequence was collisions, log injection, timer overflow,
  argument-limit crashes, and corrupted diagnostics. Inputs and output sizes
  now have explicit bounds, layout identities use collision-resistant hashes,
  large scans iterate without variadic spread, and telemetry callbacks are
  snapshotted and validated behind a bounded registry.

Three compatibility decisions remain before formal closure:

- A lockfile written by a future Veryfront version currently warns and is
  treated as empty. A subsequent old binary can therefore overwrite data it
  does not understand. The recommended change is to reject reads and mutations
  until a compatible binary or explicit migration handles the file.
- A malformed browser import map currently warns and becomes an empty map,
  silently switching client-module ownership and CDN resolution. The
  recommended change is to throw before strategy selection.
- Published `MemoCache`, `memoize`, and `memoizeAsync` retain results without a
  default eviction budget. The recommended change is a finite LRU default plus
  bounded distinct in-flight async keys, with explicit options for callers that
  need a different budget.

Reproducible checkpoint evidence:

- The complete Utils gate passes 76 suites and 1,105 nested steps with zero
  failures. The Utils, module-loader semaphore, and MDX cache-adapter matrix
  passes 78 suites and 1,171 nested steps with zero failures.
- The bundle-manifest initializer, store, MDX cache adapter, and renderer
  integration matrix passes 8 suites and 99 nested steps with zero failures.
- Changed entrypoints pass `deno check`; repository lint and formatting pass
  across 4,230 and 4,323 files respectively.
- Core dependencies and dependency boundaries report zero violations. The
  module-boundary ratchet passes without growth beyond 75 baselined broad
  imports and two baselined cycle edges.
- `deno task docs` regenerates all 39 API-reference groups.
  `deno task docs:validate` validates 66 guides, all configured guide examples,
  and all 739 documentation links.

No additional unresolved critical or high-confidence Utils risk is known. The
three listed changes alter observable published behavior and therefore remain
explicit decisions rather than being hidden inside an otherwise
backward-compatible hardening checkpoint.

### Errors closure checkpoint

The `errors` audit unit owns typed error identity, registered definitions and
troubleshooting catalogs, RFC 9457 serialization, HTTP and CLI boundaries,
retry and fallback helpers, diagnostic redaction, logging and tracing adapters,
and legacy serializable-error conversion. More than 400 source files import its
workspace surface. Its lower-level dependencies are shared diagnostic, timer,
logger, schema, and platform-compatibility primitives; routing, sandbox,
rendering, workflow, discovery, build, and most other units consume it.

The current Errors findings are remediated:

- **Symptom -> Source -> Consequence -> Remedy:** HTTP, CLI, retry, logging, and
  formatting paths classified throwables with `instanceof`, direct field
  reads, or object string conversion. The source was several independently
  evolved normalization paths. The consequence was execution of project-owned
  proxy traps, accessors, or conversion hooks during error handling, plus
  inconsistent identity and status across observers. A platform-owned,
  hook-free native brand check, an unforgeable `VeryfrontError` instance brand,
  own-data snapshots, and one boundary detacher now make proxies and arbitrary
  objects opaque while preserving genuine registered errors.
- **Symptom -> Source -> Consequence -> Remedy:** request URLs, handler
  requests, and local-project flags were read through ordinary property access
  on failure paths. The source was treating best-effort diagnostics as trusted
  input. The consequence was re-entry into tenant code while handling another
  error and possible development-detail disclosure from mutable context.
  Error boundaries now reject proxies, accept only own context data, and use
  the captured native `Request.url` getter for genuine requests.
- **Symptom -> Source -> Consequence -> Remedy:** retry callbacks could receive
  a stateful proxy, while terminal handling mixed snapshot data with the
  original throwable. The source was detaching through reads that still
  admitted proxies. The consequence was callback-dependent diagnostics and
  repeated project-code execution. Retry bookkeeping and terminal wrappers now
  receive stable detached errors; `shouldRetry: false` and unwrapped terminal
  genuine errors retain their documented original identity.
- **Symptom -> Source -> Consequence -> Remedy:** a CLI logging failure replaced
  the operation failure it was meant to report. The source was an unguarded
  logger call inside the catch path. The consequence was loss of the root cause
  and misleading caller behavior. Logging is now best effort and the original
  thrown value is always rethrown.
- **Symptom -> Source -> Consequence -> Remedy:** registered error creation read
  `detail` twice, and the legacy decoder admitted structural root objects. The
  source was property-by-property construction without first snapshotting
  options or proving native Error identity. The consequence was internally
  inconsistent message/detail pairs and ambiguous forged transport values.
  Factories read every option once; `fromError()` accepts only a genuine Error
  with an own data-valued context and returns a bounded defensive deep snapshot.
- **Symptom -> Source -> Consequence -> Remedy:** Node-specific Error and Proxy
  introspection lived in the Errors layer, and moving it naively into a shared
  import would leak `node:util` into React browser bundles. The source was
  runtime-specific compatibility logic without explicit environment ownership.
  The consequence was an architecture violation or an unresolved Node builtin
  in browser output. Server boundary introspection and the legacy decoder are
  separated from the React-safe core; runtime introspection lives in
  `platform/compat`, the browser adapter uses the standard `Error.isError`
  brand when available with a portable compatibility path, and a permanent
  browser-bundle regression rejects transitive Node imports.

Reproducible checkpoint evidence:

- The regression-first adversarial set failed 15 assertions before
  implementation. The complete Deno Errors and platform-introspection gate now
  passes 31 suites and 514 nested steps with zero failures.
- Direct Errors coverage is 85.4 percent branches, 90.6 percent functions, and
  90.3 percent lines. The new platform compatibility leaf has 100 percent line
  coverage.
- The supported Node harness passes 416 Errors and platform tests with zero
  failures. The routing module-loader, route executor, and sandbox worker
  consumer matrix passes 16 suites and 291 nested steps with zero failures. The
  direct legacy-codec consumer matrix passes another 20 suites and 225 nested
  steps with zero failures; five model-download steps remain intentionally
  ignored.
- The browser-build regression passes all six focused script tests and proves
  that the `useAgent` browser bundle contains no `node:` import.
  React error-adapter entrypoints and the Errors and platform entrypoints pass
  direct type checking.
- Changed sources pass formatting and lint. Core dependencies and dependency
  boundaries report zero violations, and the module-boundary ratchet remains at
  75 baselined broad imports and two baselined cycle edges. The Errors
  platform-specific violation is removed; the separate platform audit still
  owns the 27 pre-existing violations elsewhere in `src`.
- `deno task docs` regenerates all 39 API-reference groups.
  `deno task docs:validate` validates 66 guides, all configured executable guide
  examples, and all 739 documentation links.
- `deno task verify:quick` passes manifest freshness, formatting across 4,334
  configured files, lint across 4,241 configured files, every style and
  architecture ratchet, documentation validation, and all configured source and
  browser entrypoint typechecks.

No unresolved critical or high-confidence Errors production risk remains.
Platform, routing, sandbox, and the build-script surface changed or were
extended by this checkpoint and remain listed for their own top-level
revalidation.

### Platform closure checkpoint

The `platform` audit unit owns runtime detection and capabilities, adapter
lifecycle and selection, filesystem, HTTP, KV, process, path, and native-host
compatibility, hosted Veryfront filesystem access, and the public
`veryfront/platform`, `veryfront/platform/esbuild-init`,
`veryfront/platform/path`, and `veryfront/platform/http` surfaces. It has broad
consumers across server, rendering, build, transforms, modules, routing,
security, workflow, and shared utilities.

The first confirmed Platform findings are remediated:

- **Symptom -> Source -> Consequence -> Remedy:** concurrent adapter
  initialization, replacement, and reset could commit out of invocation order,
  resurrect a reset adapter, leak a superseded candidate, or shut down an
  adapter that was set to itself. The source was independent asynchronous
  mutations of one global registry slot. The consequence was nondeterministic
  runtime ownership and resource lifecycle. Registry operations now execute
  through one ordered queue, consecutive reads coalesce, failed candidates are
  cleaned up without replacing the active adapter, and replacement and reset
  shut down each superseded adapter exactly once.
- **Symptom -> Source -> Consequence -> Remedy:** callers could mutate shared
  platform capability records, and fractional, non-finite, or unsafe
  `maxSteps` values reached compatibility comparisons. The source was exposing
  mutable configuration objects and validating only their sign. The
  consequence was process-wide policy drift and misleading compatibility
  results. Capability data is now deeply frozen and typed read-only, and step
  limits must be positive safe integers.
- **Symptom -> Source -> Consequence -> Remedy:** the memory and SQLite KV
  adapters disagreed on prefix boundaries, value ownership, invalid inputs,
  zero limits, and failure timing; millisecond version stamps could collide;
  and an explicit durable path silently degraded to volatile memory. The source
  was duplicated serialization and fallback logic. The consequence was
  backend-dependent query results, mutable stored values, lost update
  identities, and acknowledged data that disappeared on restart. Shared
  validation now enforces string-tuple keys and JSON snapshots, prefix matching
  is exact in both backends, list limits and rejection semantics agree, version
  stamps use UUIDs, and explicit durable paths fail closed when no durable
  backend opens.
- **Symptom -> Source -> Consequence -> Remedy:** response helpers let caller
  options override their promised status or discard generated headers, while
  Node request bodies could hang after premature close and cancellation left
  listeners and the underlying request alive. The source was option spread
  order, fragmented fallback construction, and incomplete stream lifecycle
  handling. Helpers now enforce their canonical status while preserving
  metadata, serialization fallbacks retain caller headers and correlation IDs,
  and Node request streams detach listeners, destroy on cancellation, and
  reject aborted or prematurely closed bodies.
- **Symptom -> Source -> Consequence -> Remedy:** native compatibility assumed a
  global `self`, request context called mutable `AsyncLocalStorage` prototype
  methods indirectly, and Veryfront filesystem detection depended on
  constructor names and `instanceof`. The source was treating host globals,
  ambient prototypes, bundle-assigned names, and module identity as stable.
  The consequence was Node-only failures, prototype-poisoning exposure, and
  false adapter detection after bundling or duplicate module loading. Native
  host selection now falls back safely to `globalThis`, request context uses
  captured storage primordials with deterministic restoration, and adapters
  carry a descriptor-read global-symbol brand that is independent of names and
  constructor identity.
- **Symptom -> Source -> Consequence -> Remedy:** async adapter tests shared a
  200 ms wall-clock polling deadline and polled a manifest operation that
  already exposes an awaitable contract. The source was timing-based
  synchronization that predated the async API. The consequence was unrelated
  failures under the supported Node runner's normal shard load. Manifest tests
  now await the in-flight operation directly, and remaining fire-and-forget
  assertions use a monotonic CI-sized deadline while still returning
  immediately on success.

Reproducible checkpoint evidence:

- Regression-first tests reproduced adapter replacement/reset races, mutable
  global capabilities, KV prefix and durability errors, response metadata loss,
  request-stream hangs, missing Node `self`, dynamic storage-prototype lookup,
  and bundle-renamed adapter misclassification before remediation.
- The complete Deno Platform suite passes 177 suites and 2,413 nested steps
  with zero failures.
- The supported Node harness passes all four Platform shards, totaling 1,587
  tests with zero failures.
- Changed Platform sources and tests pass direct formatting, lint, and type
  checking. Core dependency and dependency-boundary checks report zero
  violations, and the module-boundary ratchet remains at 75 baselined broad
  imports and two baselined cycle edges. No new Platform architecture violation
  was introduced.

The Cloudflare runtime and deployment-policy wave is also complete:

- **Symptom -> Source -> Consequence -> Remedy:** the runtime profile invented
  fixed Cloudflare CPU and agent-step ceilings, the Agent runtime silently
  clamped authored execution policy to those guesses, and the generic
  capability helper treated numeric limits and display metadata as boolean
  capabilities. The source was a deployment-specific assumption embedded in a
  global runtime profile. The consequence was behavior that changed according
  to an inaccurate platform guess instead of explicit application policy.
  Plan-dependent CPU limits are now represented as unknown, the invariant
  128 MiB memory limit remains explicit, agent steps come only from authored
  agent/edge/execution policy, and capability queries accept only boolean
  capability keys.
- **Symptom -> Source -> Consequence -> Remedy:** the Cloudflare adapter
  advertised KV and writable storage without a binding, mutated deployment
  bindings through its environment facade, and pretended `serve()` had opened
  a listener by returning a dummy server with a hard-coded address. The source
  was a static capability record and local-runtime lifecycle assumptions
  applied to a request-driven Worker. Storage capabilities now derive from the
  supplied binding, environment writes use a request-local overlay,
  `serve()` fails with actionable `createWorker()` guidance, the dummy server
  is removed, and a typed `createCloudflareAdapter()` factory is available from
  the Platform barrel.
- **Symptom -> Source -> Consequence -> Remedy:** the KV filesystem read only
  the first list page, accepted malformed or unsorted pages, ignored
  Cloudflare's key/value byte limits, acknowledged `mkdir` without creating a
  directory, silently succeeded on mutation without a binding, allowed
  file/directory collisions, and could partially delete a non-empty directory.
  The consequence was truncated discovery, false success, ambiguous paths, and
  acknowledged destructive operations with non-atomic results. Listing now
  follows and validates cursors through empty pages, enforces sorted canonical
  keys and documented byte limits, uses reserved trailing-slash markers for
  persistent empty directories, validates parent/target types, removes files
  and empty directories atomically, and fails closed for non-atomic recursive
  directory deletion.
- **Symptom -> Source -> Consequence -> Remedy:** the Cloudflare WebSocket
  adapter ignored every upgrade option and accepted non-upgrade requests, while
  the Worker factory returned `unknown` and coupled the Platform layer directly
  to the middleware implementation. The consequence was silently lost
  subprotocol, header, and timeout intent plus an avoidable layer dependency.
  Upgrade validation now accepts only client-offered subprotocols, preserves
  application response headers, rejects runtime-managed handshake headers,
  accepts the portable zero-timeout sentinel while failing closed for
  unsupported nonzero timeouts, and reports a structured error outside the
  Worker runtime. `createWorker()` now exposes `Promise<Response>` through a
  small structural pipeline contract with no Platform-to-middleware import.

Current-wave verification evidence:

- The complete supported Deno Platform suite passes 180 suites and 2,428 nested
  steps with zero failures.
- Every supported Node Platform harness shard passes with zero failures.
- The affected Agent input-policy and factory suites pass 28 nested steps with
  zero failures.
- `deno task verify:quick` passes manifest freshness, formatting across 4,331
  configured files, lint, all style and architecture ratchets, documentation
  validation and all 739 documentation links, and every configured source and
  browser entrypoint typecheck.

The Bun and shared-runtime wave is also complete:

- **Symptom -> Source -> Consequence -> Remedy:** Bun WebSocket upgrades called
  a nonexistent global upgrade API, returned a fabricated status-101
  `Response`, and did not connect the portable socket to Bun's native lifecycle.
  The source was a placeholder modeled after another runtime rather than
  `Bun.serve`. The consequence was an adapter that could report success without
  completing a handshake or carrying data. Upgrades now require the exact
  active request, use the bound server's native `upgrade()` call, install one
  typed native WebSocket handler, bridge synchronous open/send/message/error/
  close transitions, reject duplicate or fabricated commits, and surface
  dropped sends instead of silently losing data.
- **Symptom -> Source -> Consequence -> Remedy:** Bun HTTP lifecycle reporting
  used requested rather than bound addresses, shutdown did not provide one
  retryable concurrency-safe barrier, abort and listener-failure paths leaked,
  and WebSockets were not wired into the server. The consequence was false
  readiness, nondeterministic teardown, and open listener/socket resources.
  Server creation now validates the actual bound TCP address, supports port
  zero, installs the native WebSocket bridge, force-closes active work on
  abort, shares concurrent stop calls while allowing a failed stop to retry,
  and cleans up when startup callbacks fail.
- **Symptom -> Source -> Consequence -> Remedy:** the Bun filesystem adapter
  declared a nonexistent `Bun.watch`, duplicated most of the Node adapter, and
  left watcher installation, recursive fallback, iterator return, abort, and
  concurrent reads vulnerable to races or leaked handles. The source was
  fictional runtime typing plus two drifting implementations. Bun now uses
  only documented native content fast paths and the shared Node-compatible
  filesystem implementation; Node 18 recursive fallback manages a
  symlink-safe directory watcher tree; watcher `ready` and `done` promises
  define installation and teardown barriers; return, close, and abort are
  idempotent; and concurrent `next()` fails explicitly instead of orphaning a
  waiter.
- **Symptom -> Source -> Consequence -> Remedy:** a deferred WebSocket buffered
  pre-open sends without a bound and duplicated event semantics in Node and
  Bun. The consequence was hidden memory growth and cross-runtime drift. One
  shared deferred transport now implements EventTarget-compatible listeners,
  close-before-attach behavior, binary normalization, structured transport
  failures, and the standard invalid-state failure for sends before open.
- **Symptom -> Source -> Consequence -> Remedy:** file-cache retry tests mutated
  global factories and clocks and depended on query-string module reloading.
  Bun either reused the module or separated dependency identity, so the tests
  could not prove the production concurrency contract. Backend ownership now
  lives in a factory- and clock-injected coordinator with a bounded retry
  cooldown, one shared in-flight initialization, runtime backend validation,
  and deterministic failure state. The same tests execute unchanged on Deno,
  Node, and Bun.
- **Symptom -> Source -> Consequence -> Remedy:** Bun source tests could not
  resolve vendored JSR packages or Deno workspace packages, while the preload
  duplicated native project-alias resolution and had computed the repository
  root one directory too high. The consequence was accidental resolution,
  malformed `file:/` paths in large graphs, and missing first-party extension
  peers. Test preparation now derives JSR and built workspace links from the
  authoritative Deno/npm manifests, links the built core peer, and leaves
  project aliases to Bun's native import-map owner. No application dependency
  version or runtime YAML behavior is duplicated in the harness.

Current Bun/shared verification evidence:

- The complete Deno Platform suite passes 186 suites and 2,460 nested steps
  with zero failures.
- Every supported Node Platform harness shard passes with zero failures.
- Bun 1.3.14 passes all four Platform shards: 1,629 tests total, 1,628 passed,
  one intentional Deno-only skip, and zero failures.
- Native Bun integration covers ephemeral-port HTTP serving, subprotocol
  negotiation, synchronous WebSocket open, bidirectional frames, forced
  shutdown, native file reads/writes, and real `node:fs.watch` delivery.
- The focused file-cache lifecycle contract passes 45 tests independently on
  Deno, Node, and Bun. Focused watcher, filesystem, HTTP, and WebSocket tests
  pass 13 suites and 80 nested steps under Deno in addition to the native Bun
  integrations.
- Module and dependency boundaries pass. Five obsolete broad-import baseline
  entries were removed, leaving 70 baselined broad imports and two baselined
  cyclic edges.
- `deno task verify:quick` passes manifest freshness, formatting across 4,339
  configured files, lint across 4,246 configured source files, every style and
  architecture ratchet, extension contracts, 66 public guides, all 739
  documentation links, and every configured source and browser entrypoint
  typecheck.

The Node transport and shared server-lifecycle wave is also complete:

- **Symptom -> Source -> Consequence -> Remedy:** Node ignored
  `WebSocketUpgradeOptions`, echoed the client's entire protocol offer into its
  sentinel, let `ws` silently choose the first protocol on the wire, and
  converted every inbound frame to text. The source was a mock-oriented bridge
  that never implemented the portable option or `ws` message contracts. The
  consequence was application intent diverging from the handshake, invalid
  multi-protocol responses, lost custom headers, and corrupted binary data.
  One shared portable validator now owns protocol, header, and timeout rules
  for Node, Bun, and Cloudflare; Node validates the RFC 6455 request, applies
  exactly the selected protocol, and preserves binary frames as exact
  `ArrayBuffer` copies.
- **Symptom -> Source -> Consequence -> Remedy:** both Node upgrade entry
  points treated any structurally valid upgrade sentinel as authorization, and
  the development-handler bridge discarded its headers. A forged sentinel
  could therefore reach a status-101 handshake without an application socket,
  while a legitimate sentinel's protocol and cookies or custom headers never
  reached the client. A request-scoped handshake controller now configures
  `ws` in both entry points, requires a matching pending application socket,
  injects only non-managed response headers, aborts disconnected synthetic
  requests, and retires correlation state on every exit.
- **Symptom -> Source -> Consequence -> Remedy:** a normal HTTP request that
  returned an upgrade sentinel was left open, and Node shutdown could wait
  forever for an active handler that was itself waiting for the request abort
  caused by disconnect. Normal requests now reject upgrade-only responses with
  a terminal HTTP 500, and shutdown closes active connections after stopping
  acceptance so Fetch signals abort and body readers cancel deterministically.
- **Symptom -> Source -> Consequence -> Remedy:** Node, Bun, and Deno adapters
  retained only the most recently started server. Multiple legal `serve()`
  calls therefore leaked earlier listeners on `shutdown()`, and a startup
  racing shutdown could escape ownership entirely. A shared managed-server
  registry now owns every returned server, unregisters successful direct
  stops, retires late startups, shares concurrent shutdown, aggregates
  independent failures, and retains only failed resources for retry.

Current Node/lifecycle verification evidence:

- Regression-first tests reproduce lost protocol/header intent, binary
  corruption, forged-sentinel handshakes, normal-request hangs, active-request
  shutdown deadlock, and multi-server leakage before remediation.
- The focused Deno source portfolio passes 15 suites and 153 nested steps with
  zero failures across Node, Bun, Cloudflare, Deno, and shared lifecycle
  contracts.
- The supported Node package harness passes every focused Node runtime and
  shared-lifecycle test, including live ephemeral-port HTTP, protocol/header
  negotiation, raw-handshake, forged-sentinel, active-request shutdown, and
  two-listener adapter shutdown scenarios.
- Bun 1.3.14 passes 116 focused Bun, Cloudflare, and shared-runtime tests with
  zero failures, including its native HTTP, WebSocket, filesystem, and watcher
  integrations.
- Changed sources pass direct formatting, lint, and source-entrypoint type
  checks. Three obsolete broad-import baseline entries were removed, leaving
  67 baselined broad imports and two baselined cyclic edges.
- The complete Deno Platform suite passes 187 suites and 2,472 nested steps
  with zero failures, and every supported Node Platform harness shard passes
  with zero failures.
- `deno task verify:quick` passes manifest freshness, formatting across 4,340
  configured files, lint across 4,247 configured source files, every style and
  architecture ratchet, 66 public guides, all 739 documentation links, and all
  configured source and browser entrypoint typechecks.

The Deno runtime and native-compatibility wave is also complete:

- **Symptom -> Source -> Consequence -> Remedy:** the Deno adapter kept
  environment, filesystem, HTTP, shell, and WebSocket behavior in one mutable
  504-line implementation; server addresses echoed the requested port; an
  already-aborted signal still opened a listener; shutdown owned only the
  caller's signal and tracked only the latest server. The consequence was
  false readiness, leaked listeners, nondeterministic teardown, and an adapter
  whose capability contract callers could mutate. Runtime responsibilities now
  live in focused adapters, capabilities are frozen, bound addresses come from
  the native server, startup fails before binding on pre-abort, every server is
  registered, and one internally owned, retryable shutdown barrier handles
  callback failure, abort, direct stop, and adapter shutdown.
- **Symptom -> Source -> Consequence -> Remedy:** Deno WebSocket upgrades
  accepted invalid or unoffered protocols, duplicate commits, and non-finite or
  negative timeouts, while silently discarding custom response headers that
  the native API cannot apply. The source was a runtime-specific partial
  validator and optimistic forwarding to a permissive native API. The
  consequence was handshake intent diverging from the wire contract. The
  portable validator now lives in the HTTP compatibility boundary, exposes
  explicit runtime capabilities, validates protocol and timeout input before
  native coercion, rejects duplicate request upgrades, and fails closed for
  unsupported Deno response headers.
- **Symptom -> Source -> Consequence -> Remedy:** Deno file watching polled
  recursive snapshots every 200 ms, silently tolerated missing roots, and had
  no deterministic installation, completion, or concurrent-iteration
  contract. The consequence was delayed or lost invalidation, needless I/O,
  path mismatches on canonicalized macOS roots, and orphaned iterator waiters.
  The adapter now uses `Deno.watchFs`, exposes `ready` and `done` barriers,
  maps canonical native event paths back to caller-visible roots, rejects
  concurrent `next()`, and closes native resources on abort, return, failure,
  and explicit close.
- **Symptom -> Source -> Consequence -> Remedy:** the legacy Deno HTTP
  compatibility server repeated the requested-port and external-signal
  lifecycle faults, and the crypto facade widened typed-array buffers from
  `ArrayBuffer` to `ArrayBufferLike`. The consequence was incorrect ephemeral
  addresses, unreusable or leaked compatibility servers, and strict
  cross-runtime type failures. The compatibility server now uses the same
  fail-closed address and owned-shutdown rules, while `getRandomValues`
  preserves the caller's concrete typed-array type.

Current Deno verification evidence:

- Regression-first tests reproduced mutable capability records, incorrect
  ephemeral addresses, pre-aborted listener creation, invalid timeout
  acceptance, silently dropped response headers, polling-watch lifecycle
  gaps, and external-signal shutdown ownership before remediation.
- The complete Deno Platform suite passes 190 suites and 2,496 nested steps
  with zero failures. A separate full Platform discovery/typecheck checks every
  test file with all 190 suites filtered out and reports zero type failures.
- Every supported Node Platform harness shard passes, totaling 1,646 tests
  with zero failures.
- Bun 1.3.14 passes 57 affected runtime and HTTP compatibility tests with zero
  failures; its native filesystem watcher integration also passes five
  consecutive repetitions.
- Direct Platform lint checks 353 files, and the module-boundary ratchet passes
  with 64 baselined broad imports and two baselined cyclic edges.
- `deno task verify:quick` passes manifest freshness, formatting across 4,348
  configured files, lint across 4,255 configured source files, every style and
  architecture ratchet, the reduced 20-test skip baseline, 66 public guides,
  all 739 documentation links, and every configured source and browser
  entrypoint typecheck.

The residual compatibility-HTTP lifecycle is also complete:

- **Symptom -> Source -> Consequence -> Remedy:** the public Node
  `HttpServer` reported the requested port instead of its native bound address,
  opened an already-aborted listener, overwrote an active server on a second
  `serve()`, discarded shutdown errors, and could strand a startup closed from
  its own readiness callback. The source was a second partial Node transport
  built around one mutable server slot instead of the canonical runtime
  implementation. The consequence was false readiness, leaked or unreachable
  listeners, and teardown that could not be retried. The compatibility facade
  now delegates request transport and native lifecycle to the canonical Node
  server while owning only its single-listener contract: explicit pending and
  active states, pre-bind cancellation, fail-closed callback cleanup,
  concurrent idempotent close, post-start signal shutdown, and successful
  reuse only after the prior listener is retired.
- **Symptom -> Source -> Consequence -> Remedy:** Node response streaming
  ignored `write()` backpressure, collapsed distinct `Set-Cookie` headers,
  omitted status text and request cancellation, and attempted a second 500
  response even after headers were committed. A disconnected client could
  therefore leave a response reader and handler running, while wire metadata
  differed from the returned Fetch response. The bridge now waits for drain,
  preserves native cookie multiplicity and status text, propagates disconnect
  through the Fetch `AbortSignal`, cancels the response reader, and destroys a
  committed failed response instead of writing an invalid second response.

Current compatibility-HTTP verification evidence:

- Regression-first tests reproduced the zero ephemeral port, pre-aborted
  listener creation, and concurrent ownership loss before remediation.
- The complete Deno compatibility-HTTP directory passes 19 suites and 94
  nested steps with zero failures.
- The supported Node harness passes all 21 Node-server and request-adapter
  tests, plus all 13 canonical runtime server tests, including live lifecycle,
  response metadata, backpressure, WebSocket, and disconnect contracts.
- Bun 1.3.14 passes the same 21 compatibility tests with zero failures.
- `deno task verify:quick` passes manifest freshness, formatting across 4,349
  configured files, lint across 4,256 configured source files, every style and
  architecture ratchet, 66 public guides, all 739 documentation links, and
  every configured source and browser entrypoint typecheck.

The hosted-adapter and public-client wave is complete:

- **Symptom -> Source -> Consequence -> Remedy:** the Veryfront transports,
  API clients, and token adapters accepted weak endpoint, identifier, cursor,
  payload, and response contracts; request cancellation and singleton
  replacement could leak work or commit stale state; memory token adapters
  shared mutable storage across instances. The source was duplicated optimistic
  boundary code without one lifecycle or validation policy. The consequence
  was unbounded reads, ambiguous pagination, stale credentials, cross-instance
  state leakage, and requests surviving their owner. Hosted clients now require
  validated HTTP(S) endpoints and bounded inputs and responses, use explicit
  timeout and abort ownership, reject stalled cursor progress, classify
  retryable failures, coalesce initialization by generation, and dispose or
  replace only the state they own. Memory-backed token storage is instance
  local and snapshots caller data.
- **Symptom -> Source -> Consequence -> Remedy:** GitHub paths, refs, cache
  identities, response bodies, and error classification were permissive, and
  cached file metadata could cross repository boundaries. The consequence was
  traversal-shaped input reaching remote calls, ambiguous ref/path identity,
  unbounded error consumption, false not-found results, and one repository
  observing another repository's cache entry. Paths and refs now normalize
  before I/O, cache keys include repository and ref identity, response and
  diagnostic bodies are bounded, pagination is validated, and only an actual
  not-found response maps to absence.
- **Symptom -> Source -> Consequence -> Remedy:** the hosted filesystem mixed
  partial file indexes, mutable source context, permissive path normalization,
  stale release manifests, and fallback reads whose authority was unclear. The
  consequence was false negative existence checks, inconsistent read/stat/list
  snapshots, path aliases, and cached data outliving its project or release.
  Hosted paths now use one bounded forward-slash identity, snapshot generations
  and content context are explicit, index completeness controls fallback
  behavior, directory and file collisions fail closed, and release-manifest
  caches are scoped to their owning release identity.
- **Symptom -> Source -> Consequence -> Remedy:** realtime invalidation retained
  request credentials as background authority, accepted loosely shaped
  messages and cursors, and let reconnect, abort, and replacement races leave a
  stale socket active. The consequence was authority surviving its request,
  malformed invalidations changing cache state, duplicate reconnect work, and
  stale generations publishing events. Tokens are now project-bound,
  invalidation messages use strict schemas, one generation owns each connection
  and cursor, reconnect work is bounded, and every abort, replacement, close,
  and failed-open path deterministically retires its resources.
- **Symptom -> Source -> Consequence -> Remedy:** Redis module loading and cloud
  project resolution accepted ambiguous runtime shapes and identifiers and
  treated operational failures as missing optional state. The consequence was
  late type failures, inconsistent cloud selection, and silent degradation.
  Runtime exports and configuration are now validated before use, project
  identity is normalized once, optional absence is distinguished from
  operational failure, and unsupported configurations fail with actionable
  errors.

The residual cache, compatibility, and local-adapter wave is complete:

- **Symptom -> Source -> Consequence -> Remedy:** filesystem caches relied on
  lossy serialization and incomplete request identity; retry and circuit
  helpers admitted unsafe numeric policy and overlapping timers; invalidation
  metrics duplicated mutable state. The consequence was corrupted snapshots,
  incorrect in-flight deduplication, mutation after caching, retry storms, and
  request state surviving its owner. A strict entry codec now rejects
  unsupported values and snapshots supported data, dedupe keys include the
  complete operation identity, retry and circuit policy is bounded and
  monotonic, and request invalidation state has one generation-scoped owner.
- **Symptom -> Source -> Consequence -> Remedy:** runtime detection trusted
  overlapping globals, environment snapshots lost special own keys, dotenv
  parsing admitted unbounded or partial input, and Cloudflare environment
  bindings could be mistaken for mutable process state. The consequence was
  incorrect adapter selection, prototype-sensitive environment behavior,
  partial configuration commits, and mutation of deployment bindings. Runtime
  detection now validates coherent signals, local auto-detection is distinct
  from explicitly supplied hosted adapters, environment snapshots preserve all
  own string keys as inert data, dotenv input and expansion are bounded and
  atomic, and hosted writes use a local overlay.
- **Symptom -> Source -> Consequence -> Remedy:** command execution could buffer
  without a limit or outlive its caller; flags and filesystem shims inherited
  host coercion, prototype, regular-expression, traversal, and option drift;
  path behavior varied with the host operating system. The consequence was
  memory exhaustion, hung child processes, prototype-sensitive options,
  recursive cycles, and nonportable Windows/POSIX results. Command output,
  duration, cleanup, and errors are now bounded and explicit; shim inputs and
  recursion are validated; and a host-independent path implementation owns the
  portable semantics. The public POSIX namespace is loaded from the actual
  Deno POSIX module or Node/Bun `path.posix` and is immutable.
- **Symptom -> Source -> Consequence -> Remedy:** global-error conversion,
  standard-input multiplexing, transform initialization, virtual and framework
  source paths, React source resolution, and esbuild temporary work relied on
  optimistic throwable, concurrency, path, or cleanup assumptions. The
  consequence was secondary failures while reporting errors, concurrent-reader
  races, initialization races, source-root escape, predictable temporary
  artifacts, and leaked files. These boundaries now normalize hostile values
  without invoking unsafe user code, serialize or reject conflicting
  operations, enforce canonical roots and file URLs, allocate protected
  temporary state, and clean up on every terminal path.
- **Symptom -> Source -> Consequence -> Remedy:** mock filesystem behavior
  diverged from production adapters, runtime shells rewrote native errors,
  temporary prefixes admitted separators, local `exists()` hid operational
  failures, and production modules exposed test-only hooks while assertion
  helpers could report false success. The consequence was tests certifying
  behavior that production did not implement and callers losing actionable
  failure identity. Mocks now implement production collision, ownership, and
  error semantics; only true not-found maps to `false`; native errors remain
  intact; temporary names stay under the runtime temp root; test-only mutation
  hooks are removed; and assertion helpers fail closed.

The public documentation now states the actual runtime-detection, adapter,
filesystem, watcher, command, dotenv, path, environment, error, and hosted
storage contracts. Generated API references and the runtime-adapter
architecture guide were refreshed from the current source.

Final closure evidence:

- Direct formatting checks all 376 Platform files, direct lint checks all 373
  applicable Platform files, and direct type checking covers every Platform
  TypeScript file with zero failures.
- The complete Deno Platform suite passes 206 suites and 2,724 nested steps
  with zero failures.
- The supported Node harness passes all four Platform shards: 374, 553, 445,
  and 458 tests, totaling 1,830 tests with zero failures or skips.
- Bun is not installed in the final closure environment, so the final wave
  could not be rerun natively there. The current branch's earlier Bun 1.3.14
  evidence remains recorded above; later Bun-shared runtime paths execute the
  same Node-compatible implementation revalidated by the Node harness, and
  Deno covers the portable branch.
- Architecture, core-dependency, dependency-boundary, and module-boundary
  checks pass. The module-boundary baseline is reduced to 62 broad imports and
  two cycle edges. The 14 architecture size warnings are all owned by other
  open units.
- `deno task lint:platform` still reports 27 platform-agnostic portability
  findings, all outside `src/platform`, in modules that remain open for their
  own review; Platform itself contributes zero findings.
- Documentation validation passes all 66 guides and 739 links.
  `deno task verify:quick` passes manifest freshness, formatting across 4,369
  configured files, lint across 4,276 configured files, every enforced style
  and architecture ratchet, extension contracts, documentation validation,
  and every configured source and browser entrypoint typecheck.

No unresolved critical or high-confidence Platform production risk remains.
The `platform` audit unit is closed. Agent, Modules, Server, Transforms, Utils,
and Workflow remain listed for their own top-level revalidation because their
source changed as a Platform consumer or supporting boundary during this
checkpoint.

### Release-assets closure checkpoint

The `release-assets` audit unit owns the content-addressed release build,
manifest schema, manifest cache lifecycle, production CSS compilation, HTML and
module consumption helpers, and the public `veryfront/release-assets` package
surface. Its consumers span production build, HTML and hydration generation,
the module server, rendering caches, the hosted adapter, the release API
client, and the immutable asset proxy.

The current release-assets findings are remediated:

- **Symptom -> Source -> Consequence -> Remedy:** manifest producers and
  consumers admitted mutable, oversized, prototype-sensitive, or internally
  inconsistent bodies. The source was optimistic shape checking distributed
  across boundaries. The consequence was aliasing, unsafe inherited entries,
  dangling route references, and unbounded validation work. One strict v1
  parser now validates exact shapes, canonical identities, cross-references,
  aggregate limits, and accessor-free own data, then returns a detached deeply
  frozen snapshot built from null-prototype records.
- **Symptom -> Source -> Consequence -> Remedy:** cached manifest work could
  outlive its release owner, publish after replacement, or wait indefinitely.
  The source was globally shared cache and in-flight state without complete
  ownership or cancellation semantics. The consequence was cross-project
  reuse, stale publication, and leaked background work. Cache identities are
  collision-free owner/release tuples; each generation owns its fetch,
  timeout, abort controller, publication right, and cleanup.
- **Symptom -> Source -> Consequence -> Remedy:** build inputs, transform
  output, dependency graphs, alias expansion, vendored batches, diagnostics,
  and upload acknowledgements trusted partial or unbounded results. The
  consequence was memory growth, partial dependency state surviving failed
  batches, unresolved local imports entering manifests, and builds appearing
  complete after an unacknowledged write. Every collection and byte envelope is
  bounded; canonical release and dependency paths are enforced before I/O;
  vendoring stages and commits atomically; discarded assets are removed;
  uploads and final manifest writes require exact acknowledgements.
- **Symptom -> Source -> Consequence -> Remedy:** equal bytes under different
  media types shared an incomplete identity, while CSS, route closures, and
  fallback diagnostics could exceed the manifest contract. The consequence was
  ambiguous upload state and producers creating bodies their own consumers
  could not validate. Asset identity now includes hash and allowlisted content
  type; CSS candidates, route references, dependency specifiers, and diagnostic
  gaps share explicit producer-and-consumer limits.
- **Symptom -> Source -> Consequence -> Remedy:** module fallback responses
  recognized bundle-shaped absolute paths without proving filesystem
  ownership. The consequence was a manifest-controlled path potentially
  reaching a generic text reader. Local dependency rewrites now require a
  canonical path inside the owned HTTP-bundle cache root, require a regular
  file, enforce size bounds before and after reading, and leave uncovered
  modules uncached on the established release-scoped JIT path.
- **Symptom -> Source -> Consequence -> Remedy:** the supported package surface
  omitted the module while internal declarations and documentation drifted from
  consumer reality. The consequence was source-relative consumption and no
  published type contract. `veryfront/release-assets` is now an explicit Deno
  and npm export with a consumer fixture, generated API reference, module
  reference, and public entrypoint typecheck.
- **Symptom -> Source -> Consequence -> Remedy:** the upstream first-deploy
  flow added App Router route discovery and an embedded framework dependency
  while the hardened branch required canonical release paths, deduplicated
  diagnostics, and an enforced CLI/public-module boundary. A mechanical merge
  could have weakened path validation, dropped the embedded module, duplicated
  gaps, or introduced a forbidden private CLI import. The reconciled route
  derivation supports Pages and App Router semantics only after complete
  bounded-path validation, preserves the embedded dependency fallback through
  the deduplicated diagnostic path, and exposes route derivation through the
  documented `veryfront/release-assets` surface.

Current release-assets verification evidence:

- The complete module passes 10 suites and 120 nested steps with zero failures
  on the merged source state.
- Thirty directly affected consumer suites pass 807 nested steps, and the
  proxy/static-generation pair passes two suites and 28 nested steps, all with
  zero failures.
- Direct formatting, lint, and type checks pass for the changed release-assets
  and module-server surface.
- Documentation validation and coverage pass 40/40 API reference pages, all 67
  guides, every configured guide contract and example, and all 746 links.
- The npm export verifier resolves the release-assets package surface, the Node
  smoke harness passes all 90 checks, and published-composition consumer
  typechecking is clean.
- Manifest freshness, formatting, lint, style and architecture ratchets,
  extension contracts, documentation validation, and every configured source
  and browser entrypoint typecheck pass through `deno task verify:quick`.

The two intentional availability paths are explicit rather than silent
degradation: uncovered manifest entries use the existing authenticated,
project- and release-scoped JIT path, and the global manifest fetcher is
reserved for simple single-project or test setups while hosted runtimes
register release-scoped owners. Neither path bypasses authorization. No
unresolved critical or high-confidence release-assets production risk remains;
the `release-assets` audit unit remains closed after the upstream route and
hydration changes were reconciled and the complete module portfolio was rerun.
Build, HTML, Modules, Rendering, and Server remain listed for their own
top-level revalidation because their source or generated consumers changed
during these checkpoints.

### Schedule closure checkpoint

The `schedule` audit unit owns the public recurring-schedule factory and types,
canonical calendar and timezone validation, source discovery, definition
guards, integration access requirements, and the handoff to local or remote
target execution. Its direct dependencies are errors, configuration, platform
adapters, and trigger discovery/execution. Direct consumers are the general
project discovery engine, the `schedule` and `schedules` CLI commands, the runs
client, generated API documentation, and task, workflow, or agent targets.

The current schedule findings are remediated:

- **Symptom -> Source -> Consequence -> Remedy:** public configuration reads
  executed getters, accepted custom prototypes and unknown top-level fields,
  and retained mutable nested records. The source was a split validation path
  that used direct property access for authored config and descriptor checks
  only for discovered definitions. The consequence was user code running
  during validation, prototype-sensitive behavior, silently ignored policy
  fields, and definitions changing after registration. One fail-closed
  data-only snapshot boundary now accepts only plain records and dense plain
  arrays, rejects accessors, symbols, custom fields, and sparse or custom
  arrays, captures each value once, and returns owned target, input, health,
  and integration snapshots.
- **Symptom -> Source -> Consequence -> Remedy:** any non-empty schedule or
  timezone string crossed the public boundary, and metadata was unbounded.
  The consequence was invalid or nonportable calendars reaching deployment,
  inconsistent whitespace identity, large diagnostic work, and unsafe control
  characters. Source schedules now use a bounded canonical five-field cron
  grammar with field ranges, lists, ranges, positive steps, and month or
  weekday names. Timezones must be `UTC` or runtime-recognized IANA names; raw
  offsets are rejected. IDs reuse the trigger identifier contract, metadata is
  trimmed and bounded before expensive normalization, and diagnostics escape
  and truncate hostile property names.
- **Symptom -> Source -> Consequence -> Remedy:** `backoffLimit: 0` was
  rejected even though the runs contract defines zero as no retries, while
  duplicate scopes and resource identities were accepted. The consequence was
  an inconsistent retry API and redundant access declarations whose meaning
  depended on downstream deduplication. Backoff is now a non-negative safe
  integer, duration and run limits remain positive, and integration names,
  scopes, resources, and parent-qualified identities are bounded, normalized,
  copied, and unique.
- **Symptom -> Source -> Consequence -> Remedy:** local schedule execution
  ignored `timeoutSeconds`, primitive `--input` values were silently discarded
  for agents or reshaped for other targets, and cloud-returned timeout and
  target metadata was trusted. The consequence was local work outliving its
  authored budget, caller input changing meaning by target kind, and malformed
  hosted metadata appearing as a valid run. Local execution now requires a
  JSON object override, propagates a disposable cooperative timeout signal,
  chains bounded timer chunks so long durations cannot be truncated by host
  coercion, and always clears its timer. Remote polling validates positive safe
  timeout metadata, falls back from invalid per-run timeout values, and accepts
  only canonical task, workflow, or agent targets.
- **Symptom -> Source -> Consequence -> Remedy:** the general discovery handler
  validated a schedule but registered the original mutable definition. The
  consequence was a second discovery path bypassing schedule ownership even
  though dedicated source discovery copied definitions. General discovery now
  registers the same canonical owned snapshot, with a mutation regression over
  target, input, scopes, and resources.
- **Symptom -> Source -> Consequence -> Remedy:** public types and concepts did
  not state the recurring calendar grammar, IANA timezone boundary, retry-zero
  semantics, or the difference between platform one-time schedules and
  source-defined recurrence. The public JSDoc, generated API reference, concept
  guide, CLI help, and error recovery guidance now describe the implemented
  contract.

Current schedule verification evidence:

- The affected schedule, trigger, discovery, runs, and CLI set checks 23 test
  files and passes 55 suites with 189 nested steps and zero failures. It
  includes real temporary-project execution proving a configured schedule
  timeout reaches task code, deterministic source discovery, canonical
  ownership, remote polling deadlines, and public export identity.
- The narrow error-guidance change typechecks through the production error
  entrypoints, and all 30 error suites pass 512 runtime steps. The separately
  recorded pre-existing test-fixture cast diagnostic remains confined to its
  test and is not part of the production graph.
- Documentation validation passes all 40 generated API pages, 66 guides, 111
  public docs, executable guide contracts and examples, and all 744 links.
- Two complete generation passes produce identical manifests and bundles. The
  schedule-aware RSC bundle remains stable at SHA-256
  `b0d5fdba92ab47bd81559957a315eef514034788c07a38dc0fbfe3634e15a093`.
- `deno task verify:quick` passes manifest freshness, formatting across 4,403
  configured files, lint across 4,309 source files, every style, dependency,
  module, and extension ratchet, zero cyclic module edges, documentation
  validation, and every configured production and browser entrypoint
  typecheck.
- `deno task typecheck:consumer` rebuilds the root npm package and every
  extension from the current source, reports zero npm vulnerabilities, passes
  the root import lifecycle, and verifies the published declaration
  composition with `tsc --noEmit`.

No unresolved critical or high-confidence schedule production risk remains;
the `schedule` audit unit is closed. Discovery remains listed for its own
top-level revalidation because its registration consumer changed during this
checkpoint. The generated server bundle does not reopen Server, and the narrow
error guidance remains covered by the complete current error verification
above.

### Webhook closure checkpoint

The `webhook` audit unit owns the public source-definition factory and types,
canonical definition validation, source discovery, event filtering, agent
prompt mapping, payload preparation, and the local CLI handoff to task,
workflow, or agent execution. Its direct dependencies are errors, schemas,
configuration, platform adapters, trigger discovery and execution, and project
discovery configuration. Direct consumers are the general project discovery
engine, the `webhook` and `webhooks` CLI commands, hosted reconciliation,
generated API documentation, and task, workflow, or agent targets.

The current webhook findings are remediated:

- **Symptom -> Source -> Consequence -> Remedy:** definitions accepted
  inherited fields, accessors, custom prototypes, sparse arrays, unknown
  properties, unbounded metadata, and caller-owned nested state. The source was
  optimistic shape checking followed by direct property reads. The consequence
  was executable validation, prototype-sensitive behavior, misleading ignored
  configuration, resource abuse, and definitions changing after registration.
  One fail-closed normalization boundary now accepts exact plain records and
  dense plain arrays, captures data properties once without invoking getters,
  rejects symbols and unknown fields, bounds identifiers, metadata, filters,
  paths, prompts, and diagnostics, and returns owned target, filter, and agent
  mapping snapshots.
- **Symptom -> Source -> Consequence -> Remedy:** the public filter contract
  omitted hosted `in` comparisons, examples used a misleading `$.` path,
  agent conversation metadata was absent, and non-agent targets silently
  retained dead agent mappings. The consequence was source accepted locally
  behaving differently after reconciliation and configuration that could
  never take effect. The source model now matches the hosted operators,
  dot-path traversal, 50-condition and path limits, 20,000-character prompt
  limit, conversation modes, UUID relationship, and agent-only mapping rule.
  Filter paths are trimmed before their hosted length check.
- **Symptom -> Source -> Consequence -> Remedy:** local webhook execution sent
  every fixture directly to its target without applying the event filter or
  prompt template. The consequence was filtered events running locally,
  workflow and agent inputs diverging from hosted runs, and local tests
  providing false confidence. A shared prepared-invocation boundary now owns
  and limits payloads to 64 KiB, implements structural filter equality and all
  hosted operators, shapes task and workflow inputs consistently, renders
  recognized payload placeholders, appends context only when no placeholder
  exists, and isolates agent context. Non-matching events return the hosted
  ignored reason without discovering or starting the target.
- **Symptom -> Source -> Consequence -> Remedy:** prompt rendering inferred
  placeholder presence by comparing the rendered and original strings. A
  payload value identical to its placeholder therefore looked unrendered and
  received an unexpected appended payload. Rendering now records regex matches
  explicitly, with a regression covering an identity-preserving replacement.
  Existing hosted conversations are rejected for standalone local runs rather
  than silently ignored.
- **Symptom -> Source -> Consequence -> Remedy:** dedicated schedule and webhook
  discovery ignored configured custom or disabled paths, while the shared
  trigger scanner handled only one directory. The consequence was default
  directories loading despite project policy and no correct multi-root
  duplicate namespace. Dedicated discovery now consumes the same project
  discovery configuration as file watching and general discovery. The shared
  scanner validates a bounded data-only directory collection, treats all roots
  as one deterministic duplicate-safe namespace, de-duplicates overlapping
  roots, and preserves per-root errors. Explicit singular overrides remain
  supported.
- **Symptom -> Source -> Consequence -> Remedy:** the general discovery handler
  registered the validated webhook object without taking ownership, and the CLI
  reached into private framework files. The consequence was a mutable second
  registration path and a forbidden architectural dependency. General
  discovery now registers a new canonical snapshot. Identifier validation and
  prepared invocation are documented public `veryfront/webhook` APIs, with
  exact export-identity and built-package consumer checks.
- **Symptom -> Source -> Consequence -> Remedy:** the public docs did not state
  payload limits, target-specific input shapes, exact operators, prompt
  substitution, conversation constraints, or the fact that payload text is
  untrusted prompt content. Public JSDoc, generated API reference, architecture
  notes, CLI help, and a Diátaxis concept page now describe the implemented
  boundary. The page is indexed and protected by content-contract and runnable
  example tests.

Current webhook verification evidence:

- The final affected webhook, trigger, schedule, discovery, and CLI set checks
  25 test files and passes 57 suites with 185 nested steps and zero failures.
  It includes exact 64 KiB acceptance and overflow rejection, hostile
  accessors, structural filter semantics, identity-preserving placeholders,
  filtered target suppression, real local agent prompt/context execution,
  owned general registration, custom and disabled paths, multi-root duplicate
  rejection, overlapping-root de-duplication, and public export identity.
- Documentation generation reports all 40 API module groups and complete JSDoc
  for the new public webhook declarations. Validation passes all 67 public
  guides, 112 public docs, every guide contract and executable example, and all
  746 links.
- Core dependency, dependency boundary, CLI boundary, and module boundary
  checks pass with zero new violations and zero cyclic edges. The module
  baseline remains 62 broad imports.
- Two consecutive `deno task verify:quick` passes cover manifest freshness,
  formatting across 4,407 configured files, lint across 4,313 source files,
  every style, dependency, module, extension, documentation, and production or
  browser entrypoint typecheck.
- `deno task typecheck:consumer` rebuilds the npm package and every extension
  from current source, reports zero npm vulnerabilities, passes root import
  lifecycle checks, and verifies published composition declarations with
  `tsc --noEmit`.

No unresolved critical or high-confidence webhook production risk remains;
the `webhook` audit unit is closed. `trigger` and `schedule` remain closed after
complete affected-suite revalidation. Discovery remains listed for its own
top-level revalidation because shared discovery configuration and registration
consumers changed during this checkpoint.

### Discovery closure checkpoint

The `discovery` audit unit owns project primitive discovery, configured source
roots, deterministic file collection and module loading, primitive contract
validation, agent-scoped capability discovery, registry publication, and
provider-configuration diagnostics. Its direct dependencies are configuration,
filesystem adapters, primitive registries, the TypeScript bundler, import
rewriting, errors, schemas, and shared file-discovery utilities. Direct
consumers are production-server bootstrap and reconciliation, local trigger
execution, file watching, project generation, and every source-defined agent,
tool, workflow, skill, prompt, middleware, channel, provider, integration,
schedule, and webhook.

The current discovery findings are remediated:

- **Symptom -> Source -> Consequence -> Remedy:** discovery roots were mutable,
  inconsistently validated, and able to escape the project through absolute,
  drive-relative, URL, control-character, or traversal paths. The consequence
  was caller mutation changing an in-flight generation, platform-dependent
  source selection, and adapters receiving paths outside the authored project
  boundary. Configuration now synchronously snapshots a frozen, de-duplicated
  set of at most 100 roots per primitive through one shared path policy. The
  same fail-closed policy is reused by trigger discovery, rejects unsafe paths
  before filesystem work begins, and preserves only normalized project-relative
  roots.
- **Symptom -> Source -> Consequence -> Remedy:** directory traversal was
  unbounded, swallowed read failures, depended on adapter enumeration order,
  and scanned ignored test or declaration trees. The consequence was resource
  exhaustion, partial projects presented as complete, nondeterministic
  duplicate winners, and test fixtures becoming production definitions. One
  deterministic collector now enforces safe returned names, a depth limit and
  a shared 100,000-entry project budget across all roots, propagates unexpected
  adapter failures, ignores non-production trees and files, and de-duplicates
  overlapping roots before import.
- **Symptom -> Source -> Consequence -> Remedy:** primitive handlers trusted
  shallow shapes, tool schemas retained caller-owned executable or exotic
  objects, and agent-scoped aliases could overwrite the same namespace
  silently. The consequence was malformed public primitives failing later,
  post-registration mutation changing provider contracts, and capability
  identity depending on export order. Handlers now validate their published
  public contracts, take bounded data-only schema snapshots without relying on
  private schema internals, sort exports deterministically, collapse aliases of
  the same object, and report distinct duplicate or sanitized-name collisions
  structurally.
- **Symptom -> Source -> Consequence -> Remedy:** failed or repeated discovery
  could leave a mixture of stale and newly registered primitives. The
  consequence was startup state depending on which handler failed and
  rediscovery retaining removed prompts or capabilities. Generation now treats
  all six discovery-owned registries as one publication transaction. Direct
  discovery atomically publishes its complete valid subset for compatibility;
  the production lifecycle uses the strict replacement boundary and restores
  the previous generation when any definition is invalid. Production server
  bootstrap therefore fails before listening instead of serving partial
  project state.
- **Symptom -> Source -> Consequence -> Remedy:** transpiled modules were cached
  without complete project, adapter, or dependency identity, cache storage was
  unbounded, and a cache clear racing dependency validation could resurrect
  stale code. Successful bundler calls without JavaScript also fell back to an
  empty module, while early rewrite or write failures could leak temporary
  directories. Cache identity now includes registry scope, source adapter,
  source hash, and revalidated bundled dependencies; bounded version storage,
  in-flight de-duplication, and generation guards prevent cross-project reuse
  and post-clear resurrection. Native builds without dependency metadata are
  deliberately uncached, outputless builds fail explicitly, and all temporary
  work is covered by cleanup.
- **Symptom -> Source -> Consequence -> Remedy:** package rewriting used fixed
  parent-search depths, caught unrelated filesystem and metadata failures as
  missing packages, retained stale package metadata, and bypassed declared
  `exports` through private-subpath fallback. The consequence was silent
  environment-specific resolution and imports succeeding against package
  encapsulation. Resolution now searches to the filesystem root, treats only
  absence as absence, propagates malformed or inaccessible metadata, enforces
  contained declared exports including root shorthand forms, and clears
  package-resolution state with the transpile cache.
- **Symptom -> Source -> Consequence -> Remedy:** provider diagnostics accepted
  ambiguous whitespace keys and emitted unbounded or control-bearing names and
  shell suggestions. Public documentation also omitted generation
  transactions, root constraints, ignored files, and cache boundaries. The
  validator now sorts and bounds labels, quotes them safely, escapes terminal
  controls including Unicode line separators, and emits shell-safe environment
  keys. Architecture and configuration documentation now state the implemented
  fail-closed behavior and operational limits.

Current discovery verification evidence:

- The final affected discovery, configuration, trigger, production-server,
  shared file-discovery, and import-rewriter set passes 65 suites with 218
  nested steps and zero failures. Regressions cover caller mutation, unsafe
  roots, shared scan limits, overlapping roots, same-object aliases, public
  markerless schema contracts, atomic rollback, source and dependency
  invalidation, adapter and project isolation, concurrent imports, cache-clear
  races, absent bundler metadata, outputless builds, package encapsulation,
  malformed metadata, and hostile provider labels.
- `deno task verify:quick` passes fresh manifests, formatting across 4,408
  configured files, lint across 4,314 source files, every style, dependency,
  module, and extension ratchet, zero cyclic module edges, documentation
  validation, and every configured production and browser entrypoint
  typecheck. Documentation validation covers 39 API paths, 40 generated
  reference pages, 67 guides, 112 public docs, executable guide contracts and
  examples, and all 746 links.
- The core module-boundary baseline remains 62 broad imports with no new
  violation. Core and CLI dependency boundaries remain at zero, and React
  isolation remains intact.

The host ESM loader necessarily retains each evaluated unique module URL because
the runtime exposes no unload API. Framework-owned cache maps are bounded and
cleared deterministically; production environments that perform sustained,
high-churn source replacement must recycle the worker process to reclaim the
host loader's retained module graph. This is an explicit operational boundary,
not a hidden fallback.

No unresolved critical or high-confidence discovery production risk remains;
the `discovery` audit unit is closed. The affected `config`, `trigger`,
`schedule`, and `webhook` units remain closed after complete revalidation.
Other touched consumers retain their existing ledger states until their own
top-level closure passes.

### Skill execution and hosted project-files follow-up checkpoint

This checkpoint revalidates the local and cloud Skill script-execution
boundary plus the hosted Agent project-files path. It deliberately preserves
the permissive public project-files client while giving hosted composition a
separate strict client with request-scoped cancellation and bounded remote
input handling.

The current findings are remediated:

- **Symptom -> Source -> Consequence -> Remedy:** validated local Skill
  execution could check one source-root path and launch a same-named path
  relative to the working directory. When validated content was omitted,
  local and cloud execution could also read or upload the unresolved caller
  path without proving source-root containment. The consequence was
  validation/execution path confusion and a containment bypass. One
  preparation boundary now resolves the exact lexical source path, enforces
  containment, performs a bounded read, checks file identity, compares
  supplied content when present, and returns the exact path and content used
  by both executors.
- **Symptom -> Source -> Consequence -> Remedy:** validated scripts were copied
  into source-adjacent staging files before local launch. The consequence was
  failure on read-only Skill installations, changed relative-import
  semantics, and cleanup work in a framework-owned source tree. Local
  execution now launches the exact validated original path, retains its
  script-relative imports, and leaves no source staging artifact. Generic
  public execution without a validated source root keeps its historical
  direct behavior.
- **Symptom -> Source -> Consequence -> Remedy:** the execution contract could
  be described as stronger than the operating-system boundary actually
  provided. The consequence was treating trusted local code execution as a
  sandbox or claiming an atomic byte-to-exec guarantee that the host runtime
  does not expose. Public types and the Skill how-to now state the bounded
  decoded-content and file-identity checks and explicitly retain local
  replacement between final validation and process launch as a trusted-code
  boundary.
- **Symptom -> Source -> Consequence -> Remedy:** hosted project-file requests
  used independent timeout fragments and signal-unaware composition.
  Synchronous custom fetch or trace work could outrun a deadline, pre-aborted
  calls could still invoke tracing, late responses and noncooperative streams
  could retain resources, and one cached caller could not be cancelled in
  isolation. Strict requests now use monotonic per-request and aggregate
  deadlines, exact caller reasons, disposable listener/timer scopes, bounded
  response reads, late-response cancellation, immediate reader-lock release,
  and request-scoped signals carried through initial hosted preparation.
  Concurrent calls through the cached adapter remain isolated.
- **Symptom -> Source -> Consequence -> Remedy:** a custom strict trace wrapper
  could start its callback and then reject, hang, or resolve a fabricated
  value independently. The consequence was a stranded fetch or an unvalidated
  result crossing the strict boundary. Strict tracing now permits exactly one
  callback invocation, cannot launch it after trace settlement, returns only
  the callback's validated result, consumes late settlement, and aborts every
  started request or aggregate operation on failure. The public legacy trace
  contract remains unchanged.
- **Symptom -> Source -> Consequence -> Remedy:** injecting the public,
  signal-unaware project-files client could bypass strict hosted cancellation,
  while adding a public callback argument would have changed established
  hosted contracts. Strict adapter construction now rejects that injection.
  An internal asynchronous request-preparation context carries the exact
  inbound signal across AG-UI and durable preparation, isolates concurrent
  and nested calls, and supplies a fresh non-aborted fallback only to direct
  invocations. The public legacy factory still supports custom client
  injection.

Current verification evidence:

- The hosted project-files, steering, request-context, and route portfolio
  passes 98 tests with sanitizers and zero failures. The project-files client
  contributes 65 cases, including early trace rejection and success,
  re-entrant duplicate invocation, fabricated results, noncooperative tracing
  and streams, synchronous deadline starvation, late responses, exact
  cancellation identity, timer disposal, pagination limits, and cached-call
  isolation.
- The affected Skill, filesystem compatibility, sandbox, and Agent runtime
  portfolio passes 65 suites with 333 nested steps and zero failures. It
  covers conflicting working-directory paths, omitted working directories and
  content, outside-root rejection before cloud provisioning, read-only Skill
  trees, relative imports, bounded output, cancellation, sandbox cleanup, and
  current policy consumers.
- The five CLI Skill test files pass 6 suites with 53 nested steps and zero
  failures. Generated API reference pages and the Skill guide pass
  documentation validation across all 40 reference pages, 67 guides, 112
  public docs, executable examples, and 746 links.
- `deno task verify:quick` passes fresh manifests, formatting across 4,423
  configured files, lint across 4,329 source files, every style, dependency,
  module, extension, sanitizer, and skipped-test ratchet, zero cyclic module
  edges, documentation validation, and all configured production and browser
  entrypoint typechecks. The module baseline remains 62 broad imports with no
  new violation.

No known critical or high-confidence risk remained in the narrowed execution
and initial hosted project-files paths above. At that checkpoint, later runtime
steering refresh, child-agent configuration, Skill refresh, and project
`load_skill` calls were strictly deadline-bounded but did not yet receive the
enclosing run or tool abort signal. The following Agent closure checkpoint
resolves that warning and completes the top-level Agent gate. The `skill` unit
remains in touched/revalidation-required status because reserving framework
Skill tool IDs and replacing persisted-history activation with freshly
re-derived trusted state require an explicitly approved compatibility
decision.

### Agent cancellation and lifecycle closure checkpoint

The `agent` audit unit owns public agent definitions and runtime requests,
generate/stream step preparation, hosted steering and project Skill access,
child-agent execution, remote-tool lifecycle integration, Agent service
composition, streaming, React adapters, and the public `veryfront/agent`
surface. Its direct dependencies span chat, schemas, tool, Skill, provider,
platform, sandbox, integrations, observability, and shared runtime utilities.
Its production consumers include source-defined agents, hosted Agent services,
AG-UI routes, durable child runs, Studio project tools, and package consumers.

The final open findings are remediated:

- **Symptom -> Source -> Consequence -> Remedy:** the enclosing generate or
  stream cancellation authority stopped at runtime step preparation. Later
  runtime-state refresh, child configuration, project Skill refresh and
  `load_skill` reads, and project-switch or steering-mutation callbacks could
  perform authenticated I/O after cancellation. The source was split authority
  across interfaces that retained identity but discarded the trusted tool/run
  execution context. The consequence was late remote work, stale state
  application, or post-cancellation cache mutation. `RuntimeStateRequest` now
  carries an additive optional `abortSignal`; runtime, hosted refresh, strict
  project steering, child resolution, Skill loading, and internal lifecycle
  callbacks propagate that exact authority. Separate contextual lifecycle
  callbacks preserve trusted execution context without changing the invocation
  shape of legacy public callbacks.
- **Symptom -> Source -> Consequence -> Remedy:** initial instructions and
  Skill steering reads were launched as independent promises, so one failure
  left its sibling running, while step-boundary refresh fallback could convert
  caller cancellation into cached steering. The source was unstructured
  sibling concurrency and failure fallback that did not distinguish
  cancellation. The consequence was wasted remote work and stale instructions
  surviving a cancelled run. A disposable derived abort scope now forwards the
  exact caller reason, aborts the sibling on first failure, consumes both
  promise outcomes, and removes its listener. Runtime refresh checks
  cancellation before and after all parallel work and never treats caller
  cancellation as a recoverable lookup failure.
- **Symptom -> Source -> Consequence -> Remedy:** an injected project Skill
  adapter could ignore its signal, settle after cancellation, or return an
  access-denied error after the caller aborted. The loader could then cache the
  late value or activate builtin fallback. The source was signal forwarding
  without a post-read authority check and error classification taking
  precedence over cancellation. The consequence was observable work and
  policy state crossing a cancelled tool boundary. Project Skill reads now
  check the exact signal before and after adapter settlement, cancellation wins
  over access-denied fallback, and `load_skill` checks again before caching a
  body or reference.
- **Symptom -> Source -> Consequence -> Remedy:** one Cloud system-message test
  still expected Markdown interpolation after the strict Skill prompt builder
  moved untrusted tool names to JSON encoding. The source was a stale
  cross-module assertion from the earlier security hardening checkpoint. The
  consequence was a false full-suite failure and ambiguity about the intended
  prompt contract. The assertion now verifies the encoded strict form; no
  production behavior changed.

Current Agent verification evidence:

- The complete `src/agent` portfolio passes 928 tests with 1,603 nested steps
  across 226 test files and zero failures. This includes runtime state,
  generate/stream cancellation, strict project-file requests, sibling
  cancellation, refresh fallback, child-agent project resolution, mutation and
  project-switch lifecycle context, Skill body/reference reads, AG-UI, durable
  execution, service routes, streaming, and package-surface contracts.
- The two loader suites pass 59 focused cases after proving both new
  cancellation regressions red before the remedies. The broader
  cancellation-focused integration portfolio also passes runtime, hosted
  refresh, strict adapter, remote source, default runtime, and Cloud service
  paths.
- Every changed Agent test and the public Agent barrel typecheck. The npm
  package was rebuilt from current source and the documented consumer
  composition passed `tsc --noEmit` against the emitted declarations.
- Generated API references and the Agent guides pass documentation validation:
  all 40 reference pages, 67 guides, 112 public documentation files,
  executable guide examples, and all 746 links are valid.
- `deno task verify:quick` passes fresh manifests, formatting across 4,423
  configured files, lint across 4,329 source files, every style, dependency,
  module, extension, sanitizer, and skipped-test ratchet, zero cyclic module
  edges, documentation validation, and all configured production and browser
  entrypoint typechecks. The module baseline remains 62 broad imports with no
  new violation.

The optional signal on legacy public adapters remains source-compatible.
Framework-owned hosted paths always provide a request or tool signal and use
the strict deadline-bounded project-files client. A custom public adapter that
ignores its optional signal cannot be forcibly interrupted while its own
promise remains pending, but its result cannot cross the cancellation boundary
after settlement; this is an explicit low residual at an injected external
boundary, not a hidden fallback.

No known unresolved critical or high-confidence Agent production risk remains.
The `agent` audit unit is closed at 33 of 58 formal units.

### Testing cross-runtime semantics and isolation closure checkpoint

The `testing` audit unit owns the public `veryfront/testing` and
`veryfront/testing/assert` surfaces, Deno/Node/Bun BDD adaptation, portable
assertions, process-environment and global-fetch isolation, temporary
filesystem helpers, polling and timing behavior, and application-wide test
cleanup. Its direct production dependencies are the platform runtime, process,
filesystem, and time-scale compatibility layers, the shared error catalog, and
the default bundler-contract initializer. Its consumers span 1,800-plus source
and test files, with especially direct dependencies in platform expectations,
agent, embedding, integrations, observability, server, tool, and transform
tests.

The current findings are remediated:

- **Symptom -> Source -> Consequence -> Remedy:** Node and Bun considered
  signed zero unequal and rejected a null-prototype record that Deno's
  `@std/assert` accepted. The source was delegating portable equality to
  Node's stricter `isDeepStrictEqual`. The consequence was assertions and
  expectation matchers changing meaning by runtime. The compatibility helper
  now follows the pinned `@std/assert` 1.0.19 value semantics in every runtime,
  preserves the historical third argument, carries the upstream MIT notice,
  and has explicit signed-zero, prototype, built-in, and cyclic-graph
  regressions.
- **Symptom -> Source -> Consequence -> Remedy:** Node and Bun
  `assertObjectMatch` recursively revisited matching cyclic objects until the
  stack overflowed and treated shared object identity as structure, while
  Deno's delegated matcher accepted unequal Date or RegExp values inside Maps.
  The source was naive local recursion plus two runtime-specific matcher
  implementations. The consequence was a portable assertion crashing on valid
  cyclic subsets or producing different outcomes by host. One portable matcher
  now owns every runtime, tracks compared object pairs, handles arrays and
  keyed collections deliberately, compares Date and RegExp values, accepts
  repeated references by structure, and emits bounded safe diagnostics.
- **Symptom -> Source -> Consequence -> Remedy:** a single `withMockFetch`
  queue deadlocked sequential nesting, while bypassing that queue for every
  active async owner let concurrently started nested siblings overwrite the
  process-global fetch and restore descriptors out of order. The consequence
  was deterministic deadlock, cross-test corruption, or the wrong mock
  surviving after settlement. Hierarchical async scopes now serialize
  independent callers and sibling children, allow deeper re-entrant nesting,
  drain accepted children before parent restoration, reject stale inherited
  scope ownership, and restore the exact original descriptor even when
  callback and restoration failures combine.
- **Symptom -> Source -> Consequence -> Remedy:** `waitFor` slept for the full
  polling interval even when only a few milliseconds remained, then invoked
  the predicate once more after its deadline. A 20 ms timeout with a 1,500 ms
  interval therefore took about 1.5 seconds or accepted state that became true
  out of budget. The helper now performs one immediate attempt, uses a
  monotonic deadline, caps every sleep to the remaining budget, and does not
  schedule a post-deadline attempt.
- **Symptom -> Source -> Consequence -> Remedy:** the Bun adapter read a
  nonexistent default `bun:test` export and passed timeout options in the Node
  position instead of Bun's third positional argument. Skip/only capabilities
  were optional and unsupported runtimes could fail later during registration.
  The consequence was Bun initialization failure, ignored timeout policy, or
  partial modifier behavior. A separately testable adapter now validates all
  required named exports and modifiers up front, preserves explicit zero and
  infinite timeouts, uses the supported positional timeout, and registers
  portable tests through Bun's explicit serial runner.
- **Symptom -> Source -> Consequence -> Remedy:** Bun lifecycle hooks execute
  in async contexts that do not carry an `AsyncLocalStorage` overlay into the
  test body. Hook and test environment mutations could therefore leak across
  suites, and an initial global-hook repair attached to the first importing
  test file and deadlocked nested suites. Top-level suites now install scoped
  before/after snapshots at suite-registration time, nested suites reuse that
  ownership without a second lock, raw test bodies receive their own queued
  snapshot, and restoration aggregates failures without hiding the test error.
  The public reference states the remaining Bun root-hook behavior instead of
  promising isolation that the host cannot provide.

Current Testing verification evidence:

- The complete unit passes across all supported hosts, including the exact
  CI-pinned Bun 1.3.14 runtime and Bun's four-way runner setting. The final
  passes cover 17 Deno tests with 48 nested steps, 51 Node tests, and 50 Bun
  tests with one intentional Node-only resolver skip. The portable contracts
  include nested suites, raw tests, cyclic and keyed-collection assertions,
  sequential and concurrent nested fetch scopes, child-scope draining,
  environment restoration, strict polling deadlines, and adapter
  registration.
- All 19 Testing source and test files pass Deno typecheck, lint, and format
  checks. The focused-test and skipped-test ratchets remain at zero new focused
  tests and the existing 20-test skipped baseline.
- Twenty-nine direct high-impact consumer files pass 39 Deno tests with 786
  nested steps across agent, client, config, embedding, HTML, integrations,
  observability, platform, React, rendering, server, tool, and transforms.
  Representative Node and Bun consumer runs each pass 42 cases for
  expectation, object-subset, and remote-fetch behavior.
- The npm package rebuild and documented consumer `tsc --noEmit` gate pass
  against the emitted declarations. The regenerated Testing API reference
  describes the cross-runtime contract and passes validation with all 40
  reference pages, 67 guides, 112 public documentation files, executable
  examples, and 746 links.
- `deno task verify:quick` passes fresh manifests, formatting, lint, every
  style, dependency, module, extension, sanitizer, focused-test, and
  skipped-test ratchet, documentation validation, and all configured
  production and browser entrypoint typechecks. The module baseline remains 62
  broad imports with zero baselined cyclic edges.

Bun root-level lifecycle hooks retain Bun's native process-wide environment
semantics because a shared imported adapter cannot safely install a per-file
root hook without caller-stack inference or cross-file global ownership.
Tests that mutate environment state in hooks must place those hooks inside a
`describe` suite to receive the verified snapshot boundary. Raw test bodies
remain isolated. This is an explicit low residual and documented usage
constraint; no hidden fallback is used.

`withMockFetch` necessarily serializes independent and sibling scopes because
`globalThis.fetch` can represent only one process-wide value. A later sibling
must not be responsible for releasing an earlier sibling, and callers must
await every scope. Deeper nesting remains supported, accepted child work is
drained before parent restoration, and this ordering constraint is stated at
the helper boundary.

No known unresolved critical or high-confidence Testing production risk
remains. The `testing` audit unit established the 34-of-58 closure checkpoint.

### Data execution and cache closure checkpoint (breaking cache policy pending)

The `data` audit unit owns page-loader selection, request-time and static
execution, static-path production, result control objects, execution admission,
static-data caching and revalidation, and the isolated data-worker boundary.
Its correctness identity comes from Rendering's request-local project and
content source, while its execution limits and worker lifecycle cross the
Security sandbox and shared Utils primitives.

The current deep review has remediated these findings:

- **Symptom -> Source -> Consequence -> Remedy:** mutable loader exports,
  project identities, cache scopes, and request-local content identities could
  be read more than once or after module loading had awaited. An accessor or
  caller mutation could therefore select one hook while dispatching another,
  admit work for one tenant and publish it under another cache scope, or load
  modules from one source while executing data under a later source. Loader
  exports and every execution-identity input are now read once, validated, and
  frozen at the public boundary. Rendering threads the resulting immutable
  request identity through module loading, data execution, CSS identity, and
  recovery.
- **Symptom -> Source -> Consequence -> Remedy:** timeout and cancellation
  paths released capacity when the HTTP caller stopped waiting even though
  project code, validation, or cache publication was still running. Slow or
  non-cooperative hooks could bypass concurrency ceilings and accumulate
  detached work. All three data hooks now use one fail-closed global and
  per-project admission controller. A lease remains held for the raw producer
  lifetime; server body preparation and isolated execution share one deadline,
  while caller cancellation detaches only the caller.
- **Symptom -> Source -> Consequence -> Remedy:** static cache identity,
  invalidation, and quota accounting did not form one atomic generation
  contract. Delimiter-bearing identities could alias, a noisy project could
  displace peers, a cleared or evicted in-flight load could repopulate stale
  data, and a failed size estimate could evict valid entries before rejecting
  publication. Cache keys now frame complete project, mode, source, module,
  URL, and canonical route-parameter identity. Per-project entry and byte
  ceilings enforce fair local eviction, writes prepare accounting before
  mutation, and generation-fenced single-flight, clear, replacement, and
  revalidation operations cannot resurrect superseded work.
- **Symptom -> Source -> Consequence -> Remedy:** uncached static loads and
  background revalidations bypassed or fragmented dependency circuit state.
  Repeated failures could continue hitting an unhealthy dependency by changing
  routes or disabling cache publication. Every static execution path now uses
  the same bounded project circuit. Failed revalidations keep the live value,
  back off before retrying, and cannot overwrite a newer cache generation.
- **Symptom -> Source -> Consequence -> Remedy:** isolated request bodies could
  consume unbounded memory, malformed length headers were partially parsed,
  worker concurrency lacked a strict production ceiling, and local pool
  shedding could be misclassified as a project dependency failure. The worker
  boundary now validates declared and actual body size against one 10 MiB
  limit, cancels oversized streams, requires an exact source-integration
  policy, enforces a strictly configured per-worker active-request cap, and
  keeps host admission failures neutral to project circuit health.
- **Symptom -> Source -> Consequence -> Remedy:** a project-directory worker
  key retained the worker's imported dependency graph across source changes.
  Editing only an imported module could therefore execute stale code even
  though the root module path was unchanged. Reusable workers now require a
  paired host-owned scope and immutable source-generation identity. A changed
  generation selects a fresh import graph, unversioned execution uses a unique
  single-use worker, and renderer invalidation or context disposal retires the
  entire scope after active work finishes.
- **Symptom -> Source -> Consequence -> Remedy:** worker-generation keys used
  raw delimiter-bearing scope text and did not frame the execution kind.
  Distinct Data and SSR workers could collide, while invalidating one nested
  scope could retire another. Reusable keys now frame the execution kind,
  exact UTF-16 scope identity, and immutable generation digest. Retirement
  parses and compares complete scope fields, with exact compatibility handling
  for already-issued legacy keys.
- **Symptom -> Source -> Consequence -> Remedy:** Rendering could reread a
  mutable Request, URL, renderer context, configuration, or SSR option graph
  after asynchronous hashing and module loading. Persistence policy, worker
  identity, and the actual executed request could therefore disagree. Public
  render entrypoints now synchronously snapshot the request and relevant
  configuration graph; SSR validates an owned structured snapshot before its
  first await. A host-owned execution-scope lease spans the complete render,
  replacement is published before retirement, and active old generations
  drain before eviction.
- **Symptom -> Source -> Consequence -> Remedy:** unsigned routing headers were
  read outside the trusted-topology boundary, including by the managed
  project-run endpoint. An internet caller could influence project, release,
  environment, content-source, or sibling-endpoint routing. Proxy-owned
  metadata is now accepted only on a trusted topology, and managed run routing
  uses signed control-plane claims plus the actual request origin instead of
  unsigned forwarding headers.
- **Symptom -> Source -> Consequence -> Remedy:** static-path hooks ran outside
  the shared admission policy and returned mutable, incompletely validated
  results. A large, late, or malformed producer could consume capacity after
  its caller had timed out and could mutate routing inputs after validation.
  Static-path execution now has explicit opt-in deadline semantics, retains its
  lease through late production and validation, and returns a validated
  snapshot of every path, parameter record, array, and fallback value.
- **Symptom -> Source -> Consequence -> Remedy:** negative revalidation
  intervals passed validation and were interpreted inconsistently as
  immediately stale. They can cause an unbounded refresh loop rather than a
  meaningful cache policy. Runtime validation and the public result schemas
  now reject negative values deterministically while preserving zero as the
  explicit immediately-stale interval.

Current reproducible focused evidence:

- The assembled affected portfolio passes 48 top-level Deno tests with 907
  nested steps and zero failures across Cache, Data, Rendering, Security,
  Server, and Utils. It covers admission, branded result controls, exact cache
  identity and fairness, server and static execution, static paths,
  invalidation, detached producer lifetime, request-body limits, circuit
  classification, trusted routing, renderer snapshots, worker lifecycle, and
  real isolated-worker dependency changes.
- The focused Rendering portfolio independently passes eight tests with 150
  nested steps. These regressions cover out-of-order mutable request and
  configuration inputs, source-generation changes where only an imported
  dependency changes, exact worker-key framing, leased scope rotation,
  deterministic reusable keys, and unique unversioned workers.
- The Data integration portfolio passes its 83-step production-flow suite.
  The upstream merge reconciliation adds 34 tests with 303 nested steps across
  deploy, release assets, route derivation, hydration, and browser-process
  cleanup, all green.
- The final merged tree passes repository formatting, lint and architecture
  ratchets, generated-manifest checks, all 112 public-document checks with 746
  links, every configured entrypoint typecheck, and the built npm consumer
  `tsc --noEmit` contract.
- The authored Data reference and task-oriented data-fetching guide document
  cache, timeout, admission, and isolated-generation contracts without
  publishing internal worker controls as an application API.

One production-policy decision remains open. Static-cache entries currently
retain and return the hook's original object graph. A caller or the loader can
mutate that graph after retained-size accounting, leaking state to later
requests and making byte quotas advisory. Preserving shared reference identity
is incompatible with isolation. The recommended contract is a framework-owned
bounded snapshot, a fresh graph for every caller and cold single-flight waiter,
and deterministic rejection of unsafe values. That is an observable
object-identity and value-policy change, so it requires explicit breaking-change
approval; deep-freezing, shallow copying, or remeasuring on reads would be
incomplete fallbacks and are not accepted as closure.

Formal Data closure now requires only the cache-ownership decision and the
resulting isolation/value-policy regressions. All non-breaking remediation and
the final merged-source gates are complete. Until that decision is approved
and implemented, `data` remains in `Touched, revalidation required`; the
Data checkpoint itself adds no formal closure. This section records reviewed
remediation and reproducible evidence, not premature certification.

### Root entrypoint closure checkpoint

The root-entrypoint audit unit owns the supported `veryfront` value and type
surface in `src/index.ts`, its browser/SSR-safe internal mirror in
`src/index.client.ts`, the target rewrite that selects that mirror, and the
Deno-to-npm packaging boundary that emits it without publishing an unsupported
subpath.

The current review remediated these findings:

- **Symptom -> Source -> Consequence -> Remedy:** the client mirror exported
  its small compatibility surface through broad Config, Platform, Routing,
  Data, and Security barrels. Native ESM instantiates every re-export source,
  so importing one root helper pulled unrelated adapters, route discovery,
  cache/data execution, secure filesystem, error observability, and Node
  runtime branches into the browser graph. An adversarial browser bundle was
  approximately 1.28 MiB and retained `node:path`, `node:v8`, `node:util`,
  filesystem, HTTP server, and crypto dependencies despite the “client-safe”
  contract. Both root barrels now re-export values from their owning leaf
  modules. The client graph is approximately 143 KiB on the same source state
  and retains only the intentionally handled `node:async_hooks` polyfill and
  the `node:buffer` fallback behind the browser's native `File`.
- **Symptom -> Source -> Consequence -> Remedy:** input-validation errors
  imported the complete public Errors barrel merely to obtain one error
  definition and its class. That transitive barrel was the remaining path from
  the client root into the complete error registry and memory instrumentation.
  The module now imports the canonical definition and class from their owning
  modules, preserving object and `instanceof` identity without loading
  unrelated observability code.
- **Symptom -> Source -> Consequence -> Remedy:** manual root/client mirrors
  and a build-only npm entry could drift silently in names, type aliases,
  server-only exclusions, or publication metadata. Exact `deno doc` contracts
  now pin the root surface and prove client parity modulo the three server
  bootstrap values. Packaging tests prove the mirror is compiled, stripped of
  DNT runtime shims, and removed from the published export map. A browser
  bundle regression rejects known server-only module markers and any
  unapproved Node builtin.

Current root-entrypoint verification evidence:

- The focused root, config, response, data-helper, and input-validation
  portfolio passes 21 tests with 201 nested steps. It exercises exact export
  names, root/client parity, browser graph boundaries, helper behavior, and the
  narrowed error identity.
- Browser-safe and npm metadata tests pass 20 tests with 28 nested steps,
  including build-only entrypoint collision checks and generated package
  assertions.
- The npm package rebuild completes for the root and all extension packages;
  the documented consumer composition passes `tsc --noEmit` against emitted
  declarations.
- Documentation validation passes all 40 API reference pages, 67 guides, 112
  public documentation files, executable examples, and 746 links.
- `deno task verify:quick` passes fresh manifests, full formatting and lint,
  style and architecture ratchets, dependency and extension boundaries, public
  documentation, and every configured source and browser entrypoint
  typecheck.

The build-only client mirror deliberately retains two compatibility imports:
`node:async_hooks` resolves to the framework's real browser polyfill, while
`node:buffer` supplies `File` only on Node runtimes that lack
`globalThis.File`; browsers select their native constructor. The regression
test pins this exact allowance so it cannot grow implicitly.

No known unresolved critical or high-confidence root-entrypoint production
risk remains. The root entrypoint unit is closed at 35 of 58 formal units.

### HTML deep-review checkpoint (reference update pending)

The `html` audit unit owns server-generated document shells, metadata and tag
serialization, inline hydration data, the shared production hydration runtime,
SPA navigation and module loading, and project CSS discovery and generation.
Its runtime boundary crosses Release Assets, Rendering, Modules, Server,
Routing, React, Security, and Utils; those consumers remain independently
classified by the status table above.

The current implementation review remediated these findings:

- **Symptom -> Source -> Consequence -> Remedy:** concurrent navigations shared
  one mutable owner and stale responses could commit history, router state,
  progress cleanup, scroll restoration, or React output after a newer
  navigation. Navigation is now a sequenced transaction with request-linked
  cancellation and latest-owner assertions around every asynchronous commit.
  Popstate uses the same path, query strings remain query strings, hash-only
  transitions avoid unnecessary renders, router snapshots update before React
  rendering, and subscribers are notified only after a committed transition.
- **Symptom -> Source -> Consequence -> Remedy:** page-data timeouts were
  indistinguishable from caller cancellation, retry delays ignored caller
  aborts, and discarded retry responses retained bodies. Internal deadlines
  now surface as `TimeoutError` so the active owner performs document fallback;
  caller abort remains `AbortError`, backoff is abortable, response bodies are
  canceled before retry, and hydration wait timers/listeners are cleaned up.
- **Symptom -> Source -> Consequence -> Remedy:** the initial page lacked a
  build identity, cached or prefetched page data could cross deployments, and
  speculative work could replace the active release globals. Initial and SPA
  payloads now carry stable build/release identity, cross-build foreground
  navigation reloads before rendering, and speculative module resolution uses
  an explicit immutable release context. Process start time is compared only
  in explicit development because healthy production pods naturally have
  different start times.
- **Symptom -> Source -> Consequence -> Remedy:** release coverage changed App
  Router rendering ownership, partial release maps selected the wrong
  transport, and every page embedded the complete manifest module table. Route
  ownership is now independent of transport, each page advertises only its
  page/layout/app/error module set, and covered modules, the RSC endpoint, and
  the legacy module server are selected independently per logical module.
- **Symptom -> Source -> Consequence -> Remedy:** explicit authored extensions
  could resolve a same-stem sibling, while authored JavaScript collided with
  the legacy extensionless `.js` endpoint. Hydration URLs preserve exact source
  extensions, JavaScript and MJS use an unambiguous transport suffix, and the
  module server scopes both lookup and negative-cache identity to the requested
  extension. The hydration schema accepts the same MD/MJS extension set and
  rejects non-canonical module paths.
- **Symptom -> Source -> Consequence -> Remedy:** component and page-data
  caches were FIFO or unbounded, stale in-flight imports could repopulate
  cleared state, and release-map property lookup trusted inherited values.
  Both caches now use bounded LRU behavior; one monotonic generation rejects
  pre-clear import results without path-proportional bookkeeping; module
  identity includes its resolved URL; and release maps use own-property-only
  reads.
- **Symptom -> Source -> Consequence -> Remedy:** the immutable hydration
  runtime used an eight-hex 32-bit content name while the handler could serve
  current bytes under an arbitrary versioned path. Runtime identity and its
  strong ETag now use the complete SHA-256 digest. Legacy and unknown hashes
  redirect without cacheability to the canonical path, and conditional
  requests use RFC-compatible weak comparison and quoted-list parsing.
- **Symptom -> Source -> Consequence -> Remedy:** a second unreachable SPA
  renderer duplicated the live runtime with separate cache and error behavior.
  Its internal export, source, and tests were removed after repository-wide
  consumer search established that the generated router/loader/renderer path
  is the sole production implementation.

Current reproducible evidence:

- all 40 HTML suites pass 753 nested steps with zero failures, including
  executable generated-runtime tests for latest-owner races, multi-pod build
  identity, timeout classification, abortable backoff, exact module identity,
  true LRU eviction, invalidation generations, schema parity, and hydration
  failure behavior;
- the complete Release Assets portfolio passes 10 suites with 121 nested steps,
  preserving that previously closed unit after the scoped browser-map change;
- eight affected Modules, Rendering, Release Assets, and Server suites pass 177
  nested steps; the legacy-router browser regression passes both real Chromium
  scenarios, including partial App Router release coverage;
- all 91 affected TypeScript files pass lint, the HTML and changed
  cross-module entrypoints pass typechecking, formatting and diff hygiene pass,
  and API reference regeneration succeeds for all 40 published module groups.

No known unresolved critical or high-confidence HTML implementation risk
remains. The authored `src/html/README.md` still describes removed signatures,
configuration objects, and injection behavior. Under the selected Diátaxis
workflow it is classified as **Reference** with high confidence, but authored
restructuring awaits explicit confirmation. Until that reference is replaced
and documentation validation passes, `html` remains `Deep reviewed, fixes
pending`; this checkpoint does not increment formal closure.

Update this ledger in the same commit that closes or reopens an audit unit.
