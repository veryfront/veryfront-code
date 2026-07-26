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
| Closed                         |    20 |      34.5% | Current formal closure evidence remains valid       |
| Deep reviewed, fixes pending   |     1 |       1.7% | Reviewed remediation or design work remains open    |
| Touched, revalidation required |    37 |      63.8% | Substantive recovered or current work exists        |
| Pending current review         |     0 |       0.0% | No current authoritative-branch review delta exists |
| Total                          |    58 |     100.0% | All audit units                                     |

Closed, deeply reviewed, and touched units give current-cycle substantive
coverage of 58/58 (100.0%). This is progress coverage, not a substitute for the
stricter closure count.

### Closed

- `chat`
- `config`
- `embedding`
- `eval`
- `extensions`
- `issues`
- `knowledge`
- `markdown`
- `mdx`
- `metrics`
- `provider`
- `prompt`
- `registry`
- `repositories`
- `runs`
- `runtime`
- `sandbox`
- `schemas`
- `studio`
- `version.ts`

### Deep reviewed, fixes pending

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
- `workflow`
- `index.ts`

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

The current closed review chain covers `chat`, `config`, `embedding`, `eval`,
`extensions`, `issues`, `knowledge`, `markdown`, `mdx`, `metrics`, `provider`,
`prompt`, `registry`, `repositories`, `runs`, `runtime`, `sandbox`, `schemas`,
`studio`, and `version.ts`. The latest Chat findings and the independent
adversarial knowledge, Markdown, MDX, provider, repositories, runs, runtime,
and sandbox findings are remediated and revalidated. `prompt` is closed after
its cross-cutting registry, discovery, HMR, request-lifecycle, and MCP findings
were remediated and revalidated. `registry` is closed after its scope
lifecycle, request-generation isolation, transaction invalidation, and
cross-entry validation findings were remediated and revalidated. `resource`
has received a deep current-state review and substantial remediation, but
remains open while its cache-policy breaking-change decision is unresolved. Each
closure requires a complete consumer map, deep module-level review,
adversarial boundary tests, public-contract documentation, and repository-wide
static verification.
Cross-module consumers changed by a fix remain in revalidation; focused
evidence for one boundary does not by itself close the consumer's top-level
unit. No unit now lacks a current authoritative-branch review delta; the next
dependency-ordered work closes the remaining reviewed unit and revalidates the
touched units.

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

Update this ledger in the same commit that closes or reopens an audit unit.
