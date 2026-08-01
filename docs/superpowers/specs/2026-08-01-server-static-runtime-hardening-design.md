# Server Static Runtime Hardening Design

## Status

Approved in four design sections and as a complete written specification on
2026-08-01. It covers the remaining
production-build/static-serving and generated-browser-runtime blockers found
during the Server module review. It complements the earlier Server
production-hardening design; it does not replace the runtime-profile, Node
transport, shutdown, host-parsing, or framework-candidate decisions in that
document.

## Goal

Make production static assets and generated browser runtimes fail closed at
their real trust and resource boundaries. The completed implementation must:

- admit no more than 64 MiB for one final static HTTP response body;
- avoid materializing an oversized source or transformed representation;
- bind security-sensitive source validation and reading to one file/object
  generation;
- prevent public-asset copying from overwriting or deleting output owned by a
  different writer;
- keep manifest resident and in-flight work within explicit byte and concurrency
  budgets;
- produce collision-resistant validators for reusable representations;
- keep browser bundles free of Node-only modules and third-party core
  dependencies; and
- prove the generated production artifacts in a real browser.

Assets larger than the final-body limit are delivered through a CDN or
object-delivery extension. Core does not add a hidden bypass or a weaker reader.

## Constraints

- Core source remains free of direct third-party dependencies. Runtime built-ins
  are allowed; vendor storage integrations implement contracts through
  extensions.
- Missing semantic filesystem capabilities are a breaking, typed failure on the
  affected production-build path. There is no compatibility fallback.
- GET reads use an exact limit, never `limit + 1`. HEAD proves the same GET
  capability without reading the response body.
- Generated templates and API references are regenerated only after all source
  changes are stable.
- Every behavior change follows red-green TDD, and every release claim uses
  fresh verification from the final combined tree.

## Considered filesystem approaches

### Semantic capabilities plus staged publication (selected)

Add narrow capabilities for a verified exact snapshot read and an exclusive
byte create. Keep the existing private, locked build stage and atomic directory
promotion as the transaction owner. Consumers request semantics rather than
assembling operating-system primitives themselves.

This approach gives local and remote adapters one precise contract, keeps race
policy in core, and fails closed when an adapter cannot prove the contract.

### Generic file handles

Expose open, no-follow, fstat, read, create-new, and rename primitives and let
each caller compose them. This is flexible but duplicates subtle containment,
identity, cleanup, and error rules across consumers, so it is rejected.

### Adapter-owned build transaction

Delegate the complete public-asset transaction to one adapter method. This
encapsulates races but couples the generic filesystem boundary to build policy
and is difficult for remote adapters to implement consistently, so it is
rejected.

## Filesystem capability architecture

### Per-purpose capability capture

Capability capture becomes purpose-specific. An exact-read consumer does not
inspect or validate an unrelated writer or prefix-reader capability. Each
capture operation:

- accepts only a non-Proxy object;
- captures only requested data-property methods;
- never invokes accessors;
- excludes the terminal ambient prototype in both the local and foreign realm;
- binds each captured method to the exact adapter generation; and
- returns a frozen null-prototype record.

Returned byte arrays are admitted through captured intrinsic typed-array
getters and constructors. Callers never trust live `.length`, `.byteLength`,
`.byteOffset`, `.buffer`, species, or global constructors.

### Verified exact snapshot read

`FileSystemAdapter` gains an optional semantic capability named
`readFileSnapshotWithinLimit(path, containmentRoot, byteLimit)`. It returns the
complete bytes only when all of the following are true:

1. `byteLimit` is a positive safe integer and is enforced before a complete
   oversized value can be retained.
2. The opened object is a regular file/object within `containmentRoot`.
3. A terminal symbolic link is rejected. An adapter that advertises
   `symlinkSemantics: "none"` proves the equivalent property in its keyspace.
4. Containment, object identity/generation, size admission, and reading refer to
   one snapshot.
5. The source remains the same generation through the completed read.
6. An oversized source rejects with `RangeError`; uncertainty or generation
   change rejects rather than retrying through a weaker API.

For local adapters, the implementation uses a no-follow open, reads from that
handle, compares pre/open/post metadata and canonical containment, and fails if
identity cannot be proven. A runtime without a no-follow open must provide an
equally strong adapter-native handle/generation proof or omit the capability.
The bytes are never read by reopening the pathname after validation. For
virtual/remote adapters, one object version, ETag, or immutable release
generation must fence the read.

Core defensively copies the returned value into a tight fixed `ArrayBuffer` and
records its byte length through captured intrinsic accessors. A dishonest or
malformed result is a capability failure.

`FileSnapshotChangedError` uses a private runtime brand but is exported from
the supported `veryfront/platform` adapter-author surface. External adapters
construct that error when their object/release generation changes; consumers
classify it through the exported predicate rather than a structural field.

The existing `readFileBytesWithinLimit` remains valid for non-containment
runtime reads. It does not silently satisfy the stronger snapshot capability.

### Exclusive byte creation

`FileSystemAdapter` gains `createFileBytesExclusive(path, bytes)`. It must
atomically reserve an absent destination name and reject if any entry already
owns that name. It never truncates or overwrites an existing destination.

The method guarantees exclusive name creation, not public visibility of a
partially written file. It is used only inside an owned private build stage. If
a write fails after reservation, publication cleanup removes the entire owned
stage; no caller guesses ownership and removes an individual path.

Built-in adapters implement the operation with their create-new/conditional-put
primitive. An adapter without an equivalent primitive omits the capability and
the build fails with a classified `BUILD_FAILED` error.

### Build-stage ownership

`createBuildPublication()` remains the sole transaction owner and additionally
returns an opaque `BuildOutputOwnership` token bound to its exact `buildDir` and
publication generation. Static-asset copying accepts the owned target rather
than an arbitrary output string.

The build flow is:

1. acquire the existing output lock;
2. atomically create a private, unguessable stage owned by one publication
   generation before returning its token;
3. generate normal outputs and copy public assets into that stage;
4. reserve every public-asset destination through exclusive create;
5. on any failure, remove the whole owned stage; and
6. on success, atomically promote the stage while preserving/restoring the
   previous output through the existing backup protocol.

`copyStaticAssets()` no longer records paths and removes them individually.
Therefore it cannot delete a replacement created by another owner. Compatible
directory ancestors already created by the same owned build may be reused.
File, symlink, and incompatible entry-type collisions fail; they are never
overwritten. Build setup populates the already-owned stage and never removes or
recreates its root.

Dry-run discovery remains read-only and does not require an output ownership
token or output-write capability.

## Static representation admission

### Limits and byte authority

`STATIC_ASSET_MAX_BYTES` remains exactly 67,108,864 bytes (64 MiB). The limit
applies to the final `BodyInit` bytes.

GET resolution proceeds in this order:

1. capture the exact read plan once;
2. admit trustworthy metadata when present;
3. call the root-bound snapshot reader with precisely 64 MiB; only a virtual
   adapter with `symlinkSemantics: "none"` and a positive monotonic generation
   fence may instead use an exact reader or a fixed whole-object reader whose
   upstream ceiling is at most 64 MiB;
4. copy and measure with captured typed-array intrinsics;
5. transform HTML within the same final-body limit;
6. compute representation metadata from the admitted final bytes; and
7. construct the response from the tight fixed buffer.

There is no complete-read-and-slice path and no post-materialization oversize
fallback.

HEAD captures and validates the same GET read capability and candidate
metadata, but it does not read the candidate body. For non-HTML it returns a
content length only when stat metadata is an admitted safe integer. It omits a
digest-derived ETag because producing that value would require reading the
body. For nonce-transformed HTML it also omits content length because the final
representation length is request-specific.

Local filesystems never use exact/fixed whole-file reads as a replacement for a
root-bound no-follow snapshot. A virtual generation is captured before
metadata and must be the same positive safe integer after GET reading or HEAD
metadata admission; absence or change fails closed.

### Bounded nonce transformation

Static HTML nonce injection uses a new internal byte API rather than decoding,
building an unbounded string, and encoding afterward:

```ts
transformHtmlNonceWithinLimit(
  source: Uint8Array,
  nonce: string | undefined,
  maximumBytes: number,
): Uint8Array;
```

The transform:

- fatally decodes UTF-8;
- scans comments, tags, and script/style raw text in linear spans rather than
  appending ordinary text one code unit at a time;
- replaces or inserts nonce attributes with the existing escaping rules;
- performs a first pass that calculates the exact UTF-8 output size without
  retaining the output;
- rejects before allocation when the final size exceeds the maximum; and
- performs a second pass into one exact-size fixed buffer.

Each scanner pass permits at most `2 * inputCodeUnits + 1` state transitions,
and one undecided syntactic lexeme retains at most 1,048,576 UTF-16 code units.
Comments and raw-text bodies are emitted incrementally and retain only their
delimiter suffix. Malformed UTF-8, either exact scanner complexity violation,
and final-size overflow become classified representation-unavailable failures.
The existing string and
stream nonce helpers share the same linear lexical state machine, while the
static handler uses only the bounded byte API.

A request-specific nonce makes the HTML representation unsuitable for shared
caching. Such responses use `Cache-Control: private, no-store` and do not emit
an ETag. This prevents a shared cache from replaying one request's CSP nonce.

### Collision-resistant ETags

Reusable non-HTML representations use a strong ETag derived from
`crypto.subtle.digest("SHA-256", finalBytes)`. The digest is encoded with a
dependency-free base64url helper in a stable quoted format. The previous 32-bit
hash is not retained as a fallback.

Tests include two distinct byte sequences that collide under the legacy hash
and prove they receive different new validators. Conditional GET compares only
the final strong validator.

## Manifest resource model

The per-manifest wire limit remains 33,554,432 bytes (32 MiB), with the existing
route, chunk, asset, list, and path limits. Admission adds the following
process-local budgets:

- at most 128 settled identities;
- at most 67,108,864 bytes of combined resident and in-flight weight; and
- at most two unique active manifest loads/parses.

One process-wide coordinator enforces these totals across all filesystem
adapter/repository owners. Owners are cache-key dimensions, not independent
budgets. Manifest bytes themselves require the rooted generation-bound snapshot
capability; an ordinary bounded read is not a fallback. Stat/snapshot/stat
mismatch fails as source-changed without recursive retry.

An identical identity coalesces onto one load and does not consume another
concurrency slot. A known safe stat size reserves that wire weight before the
read. Missing size reserves the full 32 MiB. A request that cannot reserve after
settled LRU eviction fails immediately; it does not join an unbounded queue.

Before `JSON.parse`, a dependency-free linear JSON lexical preflight enforces a
maximum depth of 64, a maximum of 250,000 aggregate object-member and array-item
occurrences, and a maximum of 8,192 UTF-16 code units for one JSON string. These
limits are central manifest-admission constants in addition to the existing
schema-specific route, chunk, asset, list, and path limits. This prevents a
small or boundary-size wire value from using unbounded object or nesting
amplification during parsing. The parsed manifest is validated into the minimal
lookup index; the raw text and source object are then released.

Settled cache weight is the greater of admitted wire bytes and a deterministic
retained-index estimate. The estimate includes two bytes per retained UTF-16
code unit plus a central `MANIFEST_INDEX_ENTRY_OVERHEAD_BYTES` charge of 128
bytes per map entry. It is a conservative logical resource budget, not a claim
to measure engine RSS exactly. If the settled weight cannot replace its
reservation within the global budget, the load fails closed and does not
publish an unaccounted index.

Capacity eviction selects settled LRU records only. Explicit invalidation or
identity replacement may retire an in-flight record by invalidating its
publication token. That operation may finish local work, but it cannot publish
after retirement. Reservations are released exactly once on success, failure,
or retirement. Capacity, parser, reader, and publication-token transitions are
covered under concurrent tests.

## Error model

`StaticAssetUnavailableReason` is exactly:

```ts
type StaticAssetUnavailableReason =
  | "read-capability-unavailable"
  | "invalid-capability"
  | "invalid-metadata"
  | "source-changed"
  | "byte-limit"
  | "invalid-reader-result"
  | "manifest-invalid"
  | "manifest-capacity"
  | "nonce-transform";
```

The handler maps every representation-admission or temporary capacity failure
to a sanitized 503 with `Cache-Control: no-store`. It logs only the classified
reason and safe request pathname metadata. Adapter messages, physical paths,
credentials, and raw thrown values are not reflected.

Not-found remains candidate fallback and ultimately 404. Invalid request paths
retain their existing client-error treatment. A programmer invariant or
unexpected internal fault is not mislabeled as capacity; it reaches the normal
sanitized 500 boundary.

Production-build snapshot, capability, collision, and publication failures use
`BUILD_FAILED` with a safe actionable detail and retain the original cause only
for internal diagnostics.

## Dependency-free browser graph

### Browser diagnostics and escaping

The server `platform/compat/error-introspection.ts` implementation remains
unchanged and may continue to use Node built-ins. Browser consumers must not
reach it.

`src/errors/browser-error.ts` gains
`snapshotBrowserThrowableDiagnostic(value): string`, built from captured browser
intrinsics. It reads only an authentic Error's own data-property message,
converts primitive values with a captured `String`, treats arbitrary
objects/functions as `"Unknown error"`, and caps the returned string at 2,048
code units. It does not retain name, stack, cause, accessors, or object
references. `routing/client/page-loader.ts` uses that helper instead of
`errors/safe-diagnostics.ts`.

Browser sanitizer and prefetch consumers use the existing dependency-free
`src/utils/html-escape.ts` rather than the server-oriented HTML/error-registry
graph. This removes both known paths to `node:util/types` without weakening the
server's no-hook Proxy/Error/Promise checks.

### Prebundle enforcement

The client prebundler rejects every `node:` specifier in the resolved browser
closure, including:

- static imports;
- dynamic imports;
- export-from declarations; and
- transitive dependencies reached through internal aliases.

Node specifiers are build errors, not externals and not import-map shims. The
fresh bundle must contain no unresolved internal aliases or Node specifiers and
must equal the tracked embedded router/prefetch templates byte for byte after
deterministic generation.

Client-runtime source reads use `readFileSnapshotWithinLimit` with the physical
package root and the existing 4 MiB source limit. A pre-check followed by a
pathname reopen is not accepted.

### Real artifact coverage

After the graph is clean, regenerate the router and prefetch templates. A
permanent Chromium test serves the actual generated production client assets
and the default production import map. It verifies:

- module graph linking succeeds;
- `boot()` executes;
- router and prefetch entry points initialize; and
- no console error, page error, failed `node:` request, or unhandled rejection
  occurs.

Development/proxy routes and custom test router modules do not satisfy this
gate.

## Implementation sequencing

The work is implemented and gated in dependency order:

1. filesystem capability capture, verified snapshots, exclusive create, and
   build-stage ownership;
2. static final-body admission, bounded nonce transformation, strong ETags,
   manifest preflight, and weighted cache accounting; and
3. the browser-only diagnostics/escaping graph, prebundle rejection,
   deterministic template regeneration, and real Chromium artifact test.

Each phase must be green before a later phase relies on its contracts. Template
and generated-reference writes occur only in phase 3 after all source phases
are frozen.

## Test plan

Every production change begins with a focused regression that is observed RED
for the intended reason. Required coverage includes:

### Filesystem and build publication

- verified read of an empty file, a file exactly at the requested limit, and a
  file one byte over the requested limit;
- unknown, changing, malformed, accessor-backed, Proxy, and foreign-realm
  metadata/results;
- terminal symlink and source replacement between validation and read;
- object-generation change in a virtual adapter;
- destination creation after discovery/preflight;
- exclusive-create failure without overwrite;
- failure cleanup removing only the owned stage;
- previous published output surviving generation and promotion failure; and
- missing semantic capabilities producing the exact typed build failure.

### Runtime representation

- exact 64 MiB non-HTML GET and one-byte-over rejection;
- BodyInit construction after typed-array prototype/global poisoning;
- HEAD requiring GET capability without invoking the body reader;
- linear nonce scanning across large ordinary text, comments, raw text,
  incomplete tags, and existing nonce attributes;
- nonce output exactly at and one byte beyond the final limit;
- malformed UTF-8 and non-ASCII nonce accounting;
- nonce HTML cache/ETag policy; and
- distinct validators for the known legacy-hash collision pair.

### Manifest cache

- 128 small identities within the byte budget;
- two worst-case reservations and fail-fast rejection of a third unique load;
- identical-load coalescing under pressure;
- known-size and unknown-size reservations;
- deterministic LRU eviction;
- in-flight retirement preventing stale publication;
- reservation release exactly once on every terminal path; and
- JSON/manifest depth, member, entry, string, and retained-index limits before
  unbounded parse/cache publication.

### Browser runtime

- static, dynamic, re-exported, and transitive `node:` specifier rejection;
- browser throwable snapshots under hostile values and prototype poisoning;
- source snapshot containment/generation replacement;
- fresh-to-embedded bundle equality; and
- actual production asset linking and boot in Chromium.

## Documentation and migration

Update:

- filesystem adapter reference documentation with both new semantic capability
  contracts and their exact failure behavior;
- the production-build how-to with the owned-stage/publication lifecycle;
- static-serving reference material with the final 64 MiB boundary, HEAD
  behavior, ETag/cache policy, and 503 classification;
- an adapter-author migration how-to showing how to implement or deliberately
  omit the new capabilities;
- deployment guidance directing larger assets to a CDN/object-delivery
  extension; and
- breaking-release notes for adapters that previously relied on whole-file or
  ordinary overwrite writes.

Generated API references and embedded client templates are regenerated once
from the final stable source tree.

## Verification and release gate

The Server slice cannot close until the final combined tree passes:

- focused typed filesystem, build-publication, static service/handler,
  manifest-cache, nonce, browser-error, page-loader, and client-runtime suites;
- format, lint, typecheck, generated-artifact freshness, and diff checks;
- core dependency, dependency-boundary, module-boundary, and extension-contract
  audits;
- built-in Deno, Node, and Bun adapter coverage where the runtime is available;
- production build and static-serving integration suites;
- real Chromium generated-asset linking and boot; and
- the repository's broader production verification after React and Workflow
  close.

Unavailable optional runtimes are recorded as explicit external verification
gaps; they are not silently reported green. A failed build never replaces the
previous published output. A failed runtime admission never emits a partial or
over-limit body.

## Non-goals

- No Node compatibility shim in browser code.
- No third-party parser, cache, hashing, or filesystem package in core.
- No streaming support for assets above 64 MiB in the core static handler.
- No generic file-handle API exposed to Server consumers.
- No compatibility fallback for adapters missing the new semantic capabilities.
- No redesign of unrelated Server runtime-profile, transport, or shutdown code.
