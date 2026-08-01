# Server Static Runtime Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Make production static publication, static representation admission,
manifest loading, and generated browser assets fail closed at their actual file
generation and resource boundaries.

**Architecture:** Platform exposes narrow, generation-bound read and
exclusive-create capabilities. Production build owns one opaque private stage
through atomic publication. Server admits final response bytes and manifest
work through explicit budgets. Browser artifacts are generated only from a
dependency-free, Node-free source closure and are executed in Chromium before
release.

**Tech Stack:** TypeScript, Deno and Web APIs, Node and Bun built-in filesystem
APIs, extension-provided bundling, Redis-free process-local cache coordination,
and Playwright Chromium.

**Approved design:** docs/superpowers/specs/2026-08-01-server-static-runtime-hardening-design.md

## Global Constraints

- Work only in
  /Users/agent1/code/veryfront/veryfront-code-reconcile-20260723 on
  codex/module-reconcile-20260723.
- Do not touch /Users/agent1/code/veryfront/veryfront-code.
- Begin Tasks 1-4 only after the active CSS/cache/filesystem slice is frozen and
  checkpointed because those tasks intentionally overlap Platform capability
  files.
- Preserve the frozen React slice and the active Workflow slice. Never stage
  unrelated files.
- Core source must not add a direct third-party dependency. Storage-specific
  behavior belongs behind extension or adapter contracts.
- Use strict RED -> GREEN -> REFACTOR. Observe each new regression failing for
  the intended reason before changing production code.
- No compatibility fallback may substitute readFile, writeFileBytes, a
  pathname reopen, or a complete-read-and-slice operation for a missing
  semantic capability.
- Never request or retain limit + 1 bytes. The exact static final-body ceiling
  is 67,108,864 bytes.
- Generated templates and API references are written only after all source
  tasks are frozen.
- Use apply_patch for hand edits. Use generators and formatters only for their
  intended mechanical outputs.
- Never use git add -A. Never stage src/extensions/scaffold/. Do not stage or
  regenerate deno.lock until the final intentional dependency/lock check.
- Commit each green task with explicit paths. Push after Tasks 4, 9, 12, and
  13. Integrate origin/main only from a clean tree; because this branch is
  already published and shared, merge origin/main rather than rewriting it.
- A task report must contain the exact RED command, the failing assertion, the
  exact GREEN command, and the final diff paths.

## Fixed Limits and Error Contract

| Contract | Exact value |
| --- | ---: |
| Final static BodyInit | 67,108,864 bytes |
| One manifest wire value | 33,554,432 bytes |
| Combined resident plus reserved manifest weight | 67,108,864 bytes |
| Unique active manifest loads/parses | 2 |
| Settled manifest identities | 128 |
| JSON nesting depth | 64 |
| Aggregate JSON object members plus array items | 250,000 |
| One decoded JSON string | 8,192 UTF-16 code units |
| Retained manifest map-entry charge | 128 bytes |
| Browser diagnostic | 2,048 UTF-16 code units |
| One client source file | 4,194,304 bytes |
| One pending nonce scanner lexeme | 1,048,576 UTF-16 code units |

StaticAssetUnavailableReason must end with exactly this union:

~~~ts
export type StaticAssetUnavailableReason =
  | "read-capability-unavailable"
  | "invalid-capability"
  | "invalid-metadata"
  | "source-changed"
  | "byte-limit"
  | "invalid-reader-result"
  | "manifest-invalid"
  | "manifest-capacity"
  | "nonce-transform";
~~~

## File Structure

### Platform and publication

- Modify src/platform/adapters/base.ts: raw semantic filesystem contracts.
- Modify src/platform/adapters/index.ts, src/platform/adapters/index.test.ts,
  src/fs/index.ts, and src/fs/index.test.ts: internal adapter barrel plus the
  supported public source-change error surface for adapter authors.
- Modify src/platform/adapters/file-system-capabilities.ts: purpose-specific
  safe capture.
- Create src/platform/adapters/file-system-capabilities.test.ts: hostile
  capability and intrinsic-result coverage.
- Create src/platform/adapters/file-snapshot-error.ts: source-generation
  failure brand and predicate.
- Modify src/platform/adapters/runtime/shared/node-filesystem-adapter.ts and its
  test: Node-compatible verified snapshots and exclusive creates.
- Modify src/platform/adapters/runtime/deno/filesystem-adapter.ts and its test:
  Deno verified snapshots and exclusive creates.
- Modify src/platform/adapters/runtime/bun/filesystem-adapter.ts,
  filesystem-adapter.test.ts, and filesystem-adapter.bun.test.ts: Bun
  delegation and native proof.
- Create tests/node/filesystem-snapshot-node18.test.ts and modify
  .github/workflows/cicd.yml: minimum-Node native semantic proof without Deno
  globals.
- Modify src/platform/adapters/mock.ts and mock.test.ts: deterministic semantic
  test adapter.
- Modify src/platform/compat/fs.ts and compat/fs.test.ts: carry optional
  semantic methods through the runtime-neutral filesystem facade used by the
  client prebundler.
- Modify src/platform/adapters/fs/wrapper.ts and wrapper.test.ts: preserve
  semantic capabilities without broad unrelated capture.
- Modify src/security/secure-fs.ts and secure-fs.test.ts: root-bound safe
  snapshot forwarding.
- Modify src/repositories/types.ts,
  src/repositories/filesystem/filesystem-repository.ts,
  src/repositories/testing/index.ts, and src/repositories/repositories.test.ts:
  rooted repository snapshot contract and coverage.
- Modify src/platform/adapters/veryfront-api-transport.ts and its test,
  src/platform/adapters/veryfront-api-client/client.ts and its test,
  src/platform/adapters/veryfront-api-client/operations.ts and its test, plus
  the Veryfront filesystem adapter/read operations/types/tests only if a
  bounded version-bearing response and immutable release lifecycle fence
  satisfy the contract; otherwise omit the capability explicitly.
- Modify src/build/production-build/build/build-publication.ts and its test:
  opaque stage ownership.
- Modify src/build/production-build/build/build-setup.ts and its test: populate
  an already-owned stage without deleting or replacing it.
- Modify src/build/production-build/asset-generation.ts and its test:
  generation-bound reads and exclusive destination creation.
- Modify src/build/production-build/build/output-generator.ts,
  build-orchestrator.ts, and their tests: thread ownership.
- Modify all other publication consumers and their focused tests:
  src/build/asset-pipeline/css-optimizer/optimizer-service.ts,
  src/build/asset-pipeline/image-optimizer/optimizer-core.ts,
  src/build/compiler/mdx-compiler/directory-compiler.ts, and
  src/build/embedded/preset.ts.
- Modify tests/integration/server/build/asset-generation.test.ts and
  tests/integration/server/build/build.test.ts: real publication/copy
  integration.

### Static runtime

- Create src/html/nonce-lexical-scanner.ts and
  src/html/nonce-lexical-scanner.test.ts: one linear lexical state machine.
- Modify src/html/nonce-injection.ts and nonce-injection.test.ts: string,
  stream, and bounded-byte consumers.
- Create src/server/services/static/static-asset-admission.ts and its test:
  exact read plans, intrinsic byte snapshots, and failure classification.
- Create src/server/services/static/manifest-json-preflight.ts and its test:
  bounded dependency-free JSON lexical admission.
- Create src/server/services/static/manifest-index.ts and its test: schema
  extraction and retained-weight accounting.
- Create src/server/services/static/manifest-cache.ts and its test: weighted
  reservations, two active slots, settled LRU, and publication fencing.
- Modify src/server/services/static/static-file.service.ts,
  static-file.service.test.ts, and static/index.ts: delegate to focused modules.
- Modify src/server/handlers/request/static.handler.ts and its test: final-body
  transform, HEAD parity, cache policy, and sanitized 503 mapping.
- Modify src/server/handlers/utils/etag.ts and etag.test.ts: SHA-256 validators.
- Modify every src/server computeEtag/computeStrongEtag caller and its focused
  tests so no synchronous 32-bit validator remains.

### Browser graph and release proof

- Modify src/errors/browser-error.ts and browser-error.test.ts: bounded
  browser-only throwable diagnostics.
- Modify src/routing/client/page-loader.ts and page-loader.test.ts: remove the
  server diagnostic graph.
- Modify src/security/client/html-sanitizer.ts and its tests plus
  src/rendering/client/prefetch/resource-hints.ts and its tests: use
  src/utils/html-escape.ts.
- Modify src/build/production-build/client-runtime.ts and
  client-runtime.test.ts: snapshot source reads and complete node: rejection.
- Use scripts/build/prebundle-client-scripts.ts through its write/check paths
  and account for both generated outputs; extend client-runtime/template test
  coverage for deterministic source-to-embedded equality.
- Regenerate src/build/production-build/templates.ts only in Task 12.
- Create
  tests/e2e/regressions/2026-08-01-production-client-artifacts.test.ts:
  generated-asset Chromium gate.

### Documentation

- Modify src/platform/README.md.
- Modify src/platform/adapters/README.md.
- Modify src/build/production-build/README.md.
- Modify src/server/README.md.
- Modify docs/architecture/04-server-runtime.md,
  docs/architecture/14-build-pipeline.md, and
  docs/architecture/15-runtime-adapters.md.
- Modify docs/guides/deploying.md and docs/guides/index.md.
- Create docs/guides/filesystem-adapter-migration.md.
- Regenerate affected docs/api-reference/veryfront/*.md only in Task 13.

---

### Task 1: Purpose-specific Filesystem Capability Capture

**Interfaces:**

The raw adapter gains these optional methods:

~~~ts
readFileSnapshotWithinLimit?(
  path: string,
  containmentRoot: string,
  byteLimit: number,
): Promise<Uint8Array>;

createFileBytesExclusive?(
  path: string,
  content: Uint8Array,
): Promise<void>;
~~~

The capture module produces three independent frozen null-prototype records:

~~~ts
interface CapturedSnapshotReader {
  read(
    path: string,
    containmentRoot: string,
    byteLimit: number,
  ): Promise<Uint8Array>;
}

interface CapturedExclusiveCreator {
  create(path: string, content: Uint8Array): Promise<void>;
}

interface CapturedStaticReaders {
  snapshot?: CapturedSnapshotReader;
  virtual?: {
    generation(): Promise<number>;
    exact?: (path: string, byteLimit: number) => Promise<Uint8Array>;
    whole?: { maximumBytes: number; read(path: string): Promise<Uint8Array> };
  };
}
~~~

The exact exported names are
captureSnapshotReadCapability, captureExclusiveCreateCapability, and
captureStaticReadCapabilities. Existing bounded-text capture consumes only its
read family. A malformed writer can never break a read-only consumer. The
virtual record is produced only when `symlinkSemantics` is the own data value
`"none"` and `getSourceSnapshotVersion` is a safely captured data-property
method. Its result must be a positive safe integer. Local filesystems may use
only the root-bound snapshot reader; an exact or fixed-ceiling byte reader is
not a substitute for no-follow containment and identity proof.

- [ ] **Step 1: Add capture isolation RED tests**

Add cases where readFileSnapshotWithinLimit is an own data method while
createFileBytesExclusive or maxWholeFileReadBytes is an accessor, Proxy, or
invalid value. Assert snapshot capture succeeds and invokes none of those
unrelated fields. Add the symmetric exclusive-create case.

- [ ] **Step 2: Add hostile provenance RED tests**

Assert direct Proxy objects/functions reject, local and foreign terminal
Object.prototype methods are ignored, a 65-level prototype chain rejects, and
captured methods remain bound to the exact original adapter after mutation.

- [ ] **Step 3: Add returned-byte RED tests**

Return subclassed, cross-realm, SharedArrayBuffer-backed, resizable-buffer, and
prototype-poisoned views. Assert the captured reader either produces a tight
fixed Uint8Array copied through captured intrinsic getters or rejects with the
invalid-result branch. It must never trust live length, byteLength, byteOffset,
buffer, species, or global constructors. Add the symmetric writer test: mutate
the caller's array after create begins and assert the raw exclusive creator sees
only the tight fixed copy captured at the call boundary.

- [ ] **Step 4: Run RED**

~~~bash
deno test --frozen --no-check --allow-all \
  src/platform/adapters/file-system-capabilities.test.ts \
  src/platform/adapters/bounded-text-reader.test.ts \
  src/platform/adapters/index.test.ts \
  src/fs/index.test.ts
~~~

Expected: broad capture inspects unrelated fields, and the new semantic
capabilities are absent.

- [ ] **Step 5: Implement narrow descriptor capture**

Use one bounded prototype walker that accepts an explicit readonly key list.
Stop before both local and foreign terminal ambient prototypes. Read
descriptors only with captured Reflect/Object intrinsics, reject accessors, and
bind the captured function with captured Reflect.apply. Do not read a
capability key that the selected purpose did not request. The exclusive-create
wrapper snapshots content through the same intrinsic fixed-byte copier before
invoking the adapter.

- [ ] **Step 6: Add the source-change error brand**

In file-snapshot-error.ts use a module-private WeakSet, not a public structural
field:

~~~ts
const changedErrors = new WeakSet<object>();

export class FileSnapshotChangedError extends Error {
  override readonly name = "FileSnapshotChangedError";

  constructor(message = "File snapshot changed during the read") {
    super(message);
    changedErrors.add(this);
  }
}

export function isFileSnapshotChangedError(
  value: unknown,
): value is FileSnapshotChangedError {
  return typeof value === "object" && value !== null && changedErrors.has(value);
}
~~~

Export the class and predicate from `src/platform/adapters/index.ts` and the
public `src/fs/index.ts`, with export-surface tests proving the supported
adapter-author import `veryfront/fs`. Do not add a `./platform` package export;
that infrastructure barrel deliberately remains package-private. The WeakSet
remains private; the constructor is the only supported way for an external
adapter to create a classifiable source-change failure.

- [ ] **Step 7: Run GREEN and migrate the bounded-text consumer**

Update only bounded-text-reader to request only its read family. Do not edit
SecureFs, FSAdapterWrapper, Veryfront delegation, build asset generation, or
the not-yet-created static admission module in this task. Record those existing
broad-capture call sites as deferred work owned exclusively by Tasks 3, 4, and
6. A repository-wide search must match only those explicitly scheduled call
sites.

~~~bash
deno test --frozen --no-check --allow-all \
  src/platform/adapters/file-system-capabilities.test.ts \
  src/platform/adapters/bounded-text-reader.test.ts \
  src/platform/adapters/index.test.ts \
  src/fs/index.test.ts \
  src/platform/adapters/fs/wrapper.test.ts \
  src/security/secure-fs.test.ts
~~~

- [ ] **Step 8: Commit explicit files**

~~~bash
git add src/platform/adapters/base.ts \
  src/platform/adapters/index.ts \
  src/platform/adapters/index.test.ts \
  src/fs/index.ts \
  src/fs/index.test.ts \
  src/platform/adapters/file-system-capabilities.ts \
  src/platform/adapters/file-system-capabilities.test.ts \
  src/platform/adapters/file-snapshot-error.ts \
  src/platform/adapters/bounded-text-reader.ts \
  src/platform/adapters/bounded-text-reader.test.ts
git commit -m "feat(platform): add purpose-specific filesystem capabilities"
~~~

### Task 2: Verified Local Snapshots and Exclusive Creates

**Interfaces:**

Node, Bun, and Deno advertise each raw capability only when the active
runtime/OS exposes the exact primitive and its real-runtime test proves it.
Snapshot reads use the supported `node:fs/promises` compatibility layer with a
nonzero `O_NOFOLLOW`; on Windows or any host where that exact primitive is
absent/zero, the optional method is absent from the constructed Node, Bun, or
Deno adapter and an omission/build-failure test is mandatory. Exclusive create
is installed independently when create-new semantics are proven; Deno may use
`createNew`. `Deno.open` is never used as snapshot authority. A
successful snapshot proves canonical containment, non-symlink terminal entry,
one regular file handle, stable identity/generation, and a complete value no
larger than byteLimit. RangeError means only byte-limit overflow; a generation
mismatch uses FileSnapshotChangedError.

- [ ] **Step 1: Add exact-bound RED tests**

For the shared Node-compatible implementation and each Node, Bun, and Deno
adapter factory, cover an empty file, a file exactly at the requested limit, a
file one byte over, zero/unsafe limits, directory input, and a terminal symlink.
Verify the oversized path rejects before a complete oversized buffer is
retained. Inject absent and zero `O_NOFOLLOW` values and assert every factory
omits the own snapshot data method instead of exposing a call-time failure.

- [ ] **Step 2: Add deterministic replacement RED tests**

Test the internal implementation seam with a filesystem operations record.
Replace the pathname after open and mutate the opened file between the first
and final metadata reads. Assert no pathname reopen supplies bytes and both
races reject as FileSnapshotChangedError.

- [ ] **Step 3: Run RED**

~~~bash
deno test --frozen --no-check --allow-all \
  src/platform/adapters/runtime/shared/node-filesystem-adapter.test.ts \
  src/platform/adapters/runtime/node/filesystem-adapter.test.ts \
  src/platform/adapters/runtime/deno/filesystem-adapter.test.ts \
  src/platform/adapters/runtime/bun/filesystem-adapter.test.ts
~~~

- [ ] **Step 4: Implement handle-bound snapshot reads**

The shared implementation uses node:fs/promises open with
O_RDONLY | O_NOFOLLOW and FileHandle.read. Each Node, Bun, and Deno adapter
factory delegates to it only when `O_NOFOLLOW` is nonzero and its real-runtime
tests prove the semantics. Every factory conditionally installs an own
data-property method; no class prototype may advertise a method that will fail
only when invoked. On unsupported hosts it omits the method, and tests prove
the affected build path fails closed. In the shared implementation:

1. Canonicalize the containment root.
2. Lexically reject a candidate outside the root.
3. Reject terminal links before open.
4. Open once without following the terminal link.
5. Compare candidate/handle identity and canonical containment.
6. Read exactly the handle-reported admitted size into one fixed buffer.
7. Compare handle and pathname identity, size, mtime/ctime, and canonical target
   after the read.
8. Close the same handle in finally.

Do not probe an extra byte. Growth, shrinkage, replacement, or uncertain
identity is a source-change failure.

- [ ] **Step 5: Add exclusive-create RED tests**

Create an absent binary file, collide with a file, collide with a directory,
and inject a write failure after name reservation. Assert an existing entry is
never truncated and no automatic per-path deletion guesses ownership.

- [ ] **Step 6: Implement exclusive create**

Node-compatible uses open with wx, writes through that handle, and closes it.
Deno uses createNew. Node, Bun, and Deno install the own method only when their
real runtime proves create-new collision behavior; absence is independent from
snapshot-read absence. Partial failure remains inside the private build stage
for whole-stage cleanup.

- [ ] **Step 7: Run GREEN in all available runtimes**

~~~bash
deno test --frozen --no-check --allow-all \
  src/platform/adapters/runtime/shared/node-filesystem-adapter.test.ts \
  src/platform/adapters/runtime/node/filesystem-adapter.test.ts \
  src/platform/adapters/runtime/deno/filesystem-adapter.test.ts \
  src/platform/adapters/runtime/bun/filesystem-adapter.test.ts
bun test --preload ./tests/bun/preload.ts \
  src/platform/adapters/runtime/bun/filesystem-adapter.bun.test.ts
VF_TEST_SHARDS=1 node ./tests/node/run-tests.mjs \
  tests/node/filesystem-snapshot-node18.test.ts
~~~

The dedicated Node test contains no Deno global and is added beside the
existing Node 18.18 lane in .github/workflows/cicd.yml. Record Bun or the exact
minimum Node executable as an explicit external gap if unavailable locally;
CI must execute both before release.

- [ ] **Step 8: Commit**

~~~bash
git add src/platform/adapters/runtime/shared/node-filesystem-adapter.ts \
  src/platform/adapters/runtime/shared/node-filesystem-adapter.test.ts \
  src/platform/adapters/runtime/node/filesystem-adapter.ts \
  src/platform/adapters/runtime/node/filesystem-adapter.test.ts \
  src/platform/adapters/runtime/deno/filesystem-adapter.ts \
  src/platform/adapters/runtime/deno/filesystem-adapter.test.ts \
  src/platform/adapters/runtime/bun/filesystem-adapter.ts \
  src/platform/adapters/runtime/bun/filesystem-adapter.test.ts \
  src/platform/adapters/runtime/bun/filesystem-adapter.bun.test.ts \
  tests/node/filesystem-snapshot-node18.test.ts \
  .github/workflows/cicd.yml
git commit -m "feat(platform): verify file snapshots and exclusive creates"
~~~

### Task 3: Root-Bound Wrappers, Repositories, and Virtual Adapters

**Interfaces:**

Raw adapters retain the three-argument snapshot method. SecureFs and
FileSystemRepository expose a root-bound two-argument form:

~~~ts
readFileSnapshotWithinLimit?(
  path: string,
  byteLimit: number,
): Promise<Uint8Array>;
~~~

SecureFs validates the caller path, then invokes the captured raw capability
with the validated physical path and its construction-time base directory.

- [ ] **Step 1: Add wrapper and SecureFs RED tests**

Assert traversal never reaches the raw reader, construction-time method/root
snapshots survive later mutation, unrelated malformed capabilities do not
break the snapshot reader, and malformed returned buffers fail before reaching
the consumer.

- [ ] **Step 2: Add repository RED tests**

Assert SecureFsRepository advertises the rooted method only when the adapter
does, forwards the exact byte limit, and preserves source-change and RangeError
classification. Add these cases to the existing
`src/repositories/repositories.test.ts`. Add a generation counter to
MockFileSystemRepository in `src/repositories/testing/index.ts` and test
replacement during read there; `src/platform/adapters/mock.test.ts` covers only
the raw runtime adapter and does not own repository behavior.

- [ ] **Step 3: Run RED**

~~~bash
deno test --frozen --no-check --allow-all \
  src/platform/adapters/fs/wrapper.test.ts \
  src/security/secure-fs.test.ts \
  src/repositories/repositories.test.ts \
  src/platform/adapters/mock.test.ts
~~~

- [ ] **Step 4: Implement the root-bound chain**

Capture the raw semantic method at wrapper construction. Validate and resolve
the path once in SecureFs, forward the construction-time base root, and copy
the result into a fixed intrinsic buffer before returning. Add the rooted
method to FileSystemRepository and its secure/mock implementations. Extend
src/platform/compat/fs.ts so createFileSystem() conditionally exposes and binds
both semantic raw methods; client prebundling must never bypass the adapter
contract by reaching a lower-level ordinary reader.

- [ ] **Step 5: Prove or omit virtual capabilities**

Veryfront may advertise a snapshot only when
veryfront-api-transport -> API operations -> ReadOperations preserves the
response version_id beside bounded bytes and proves the same immutable
release/object version before publication. The multi-project wrapper captures
that exact method and fences the active release lifecycle. If any link discards
the version, omit the capability. Cloudflare KV, GitHub, and other adapters
without conditional-get or immutable-generation proof omit it and gain tests
asserting absence. No virtual adapter may implement this as stat -> ordinary
read.

- [ ] **Step 6: Run GREEN**

~~~bash
deno test --frozen --no-check --allow-all \
  src/platform/adapters/fs/wrapper.test.ts \
  src/security/secure-fs.test.ts \
  src/repositories/repositories.test.ts \
  src/platform/adapters/mock.test.ts \
  src/platform/compat/fs.test.ts \
  src/platform/adapters/veryfront-api-transport.test.ts \
  src/platform/adapters/veryfront-api-client/client.test.ts \
  src/platform/adapters/veryfront-api-client/operations.test.ts \
  src/platform/adapters/fs/veryfront/read-operations.test.ts \
  src/platform/adapters/fs/veryfront/adapter.test.ts \
  src/platform/adapters/fs/veryfront/multi-project-adapter.test.ts \
  src/platform/adapters/runtime/cloudflare/filesystem.test.ts \
  src/platform/adapters/fs/github/adapter.test.ts
~~~

- [ ] **Step 7: Commit**

~~~bash
git add src/platform/adapters/fs/wrapper.ts \
  src/platform/adapters/fs/wrapper.test.ts \
  src/security/secure-fs.ts \
  src/security/secure-fs.test.ts \
  src/repositories/types.ts \
  src/repositories/filesystem/filesystem-repository.ts \
  src/repositories/repositories.test.ts \
  src/repositories/testing/index.ts \
  src/platform/adapters/mock.ts \
  src/platform/adapters/mock.test.ts \
  src/platform/compat/fs.ts \
  src/platform/compat/fs.test.ts \
  src/platform/adapters/veryfront-api-transport.ts \
  src/platform/adapters/veryfront-api-transport.test.ts \
  src/platform/adapters/veryfront-api-client/client.ts \
  src/platform/adapters/veryfront-api-client/client.test.ts \
  src/platform/adapters/veryfront-api-client/operations.ts \
  src/platform/adapters/veryfront-api-client/operations.test.ts \
  src/platform/adapters/fs/veryfront/types.ts \
  src/platform/adapters/fs/veryfront/read-operations.ts \
  src/platform/adapters/fs/veryfront/read-operations.test.ts \
  src/platform/adapters/fs/veryfront/adapter.ts \
  src/platform/adapters/fs/veryfront/adapter.test.ts \
  src/platform/adapters/fs/veryfront/multi-project-adapter.ts \
  src/platform/adapters/fs/veryfront/multi-project-adapter.test.ts \
  src/platform/adapters/runtime/cloudflare/filesystem.test.ts \
  src/platform/adapters/fs/github/adapter.test.ts
git commit -m "feat(fs): preserve generation-bound snapshot authority"
~~~

### Task 4: Opaque Build Ownership and Whole-Stage Rollback

**Interfaces:**

~~~ts
declare const buildOutputOwnershipBrand: unique symbol;

export interface BuildOutputOwnership {
  readonly [buildOutputOwnershipBrand]: true;
}

export type BuildPublication =
  | {
    readonly dryRun: true;
    readonly finalDir: string;
    readonly buildDir: string;
    publish(): Promise<void>;
    cleanup(): Promise<void>;
  }
  | {
    readonly dryRun: false;
    readonly finalDir: string;
    readonly buildDir: string;
    readonly outputOwnership: BuildOutputOwnership;
    publish(): Promise<void>;
    cleanup(): Promise<void>;
  };

export type BuildDirectorySetupTarget =
  | { readonly dryRun: true }
  | { readonly dryRun: false; readonly output: BuildOutputOwnership };

export type StaticAssetCopyTarget =
  | { readonly dryRun: true }
  | {
    readonly dryRun: false;
    readonly output: BuildOutputOwnership;
  };
~~~

BuildPublication exposes outputOwnership only for a live non-dry-run
publication. A module-private WeakMap binds the frozen null-prototype token to
buildDir, the exact filesystem object, generation, and lifecycle state. Build
setup and asset generation resolve the directory through
`resolveBuildOutputOwnership(output, expectedFileSystem): string`; they never
accept an arbitrary non-dry-run output string. The expected filesystem identity
must match the filesystem that created the publication.

- [ ] **Step 1: Add atomic-stage and ownership RED tests**

Assert `createBuildPublication()` acquires the lock and then atomically creates
its unguessable stage with a non-recursive create before returning any token.
An injected name collision fails; it never reuses or clears the colliding
directory, and it releases the acquired lock. Assert forged,
foreign-publication, wrong-filesystem, published, and cleanup-started tokens are
rejected. Dry run remains read-only without a token. Assert one token resolves
only its exact private stage.

- [ ] **Step 2: Add setup and publication-consumer RED tests**

Change `setupBuildDirectories` to accept `BuildDirectorySetupTarget`. Assert a
non-dry invocation cannot express a path string, never removes or recreates the
owned stage root, and creates only `_veryfront`, `_veryfront/chunks`,
`_veryfront/data`, and `assets` below the resolved stage. Assert the CSS
optimizer, image optimizer, MDX directory compiler, and embedded preset all
populate an already-created stage without replacing it. Cover their existing
focused tests and the real server build integrations.

- [ ] **Step 3: Add collision and rollback RED tests**

Inject a destination file after discovery but before write. Assert exclusive
create rejects without changing its bytes. Inject failure after one successful
asset and assert copyStaticAssets performs no individual remove calls; the
publication cleanup removes only its complete stage and preserves the previous
published output.

- [ ] **Step 4: Add missing-capability RED tests**

Remove snapshot read or exclusive create independently. Assert non-dry build
fails with BUILD_FAILED and a safe actionable detail. Assert dry-run inventory
still succeeds and invokes neither capability.

- [ ] **Step 5: Run RED**

~~~bash
deno test --frozen --no-check --allow-all \
  src/build/production-build/build/build-publication.test.ts \
  src/build/production-build/build/build-setup.test.ts \
  src/build/production-build/asset-generation.test.ts \
  src/build/production-build/build/output-generator.test.ts \
  src/build/production-build/build/build-orchestrator.test.ts \
  src/build/asset-pipeline/css-optimizer/optimizer-service.test.ts \
  src/build/asset-pipeline/image-optimizer/optimizer-core.test.ts \
  src/build/compiler/mdx-compiler/directory-compiler.test.ts \
  src/build/embedded/preset.test.ts \
  tests/integration/server/build/asset-generation.test.ts \
  tests/integration/server/build/build.test.ts
~~~

- [ ] **Step 6: Implement atomic stage creation and opaque ownership**

After acquiring the lock, create `buildDir` exactly once with a non-recursive
`mkdir`. If it fails, release the lock and return no publication. Only then
create the private token. Invalidate it before public promotion begins and when
cleanup begins. Keep publish and cleanup idempotence and the existing
output-lock/backup restoration behavior unchanged. `setupBuildDirectories`
resolves the live token and creates only child directories; delete its current
`remove(outputDir, { recursive: true })` branch.

- [ ] **Step 7: Replace source and destination operations**

For each file, invoke the snapshot reader with sourcePath, the canonical public
root, and exactly STATIC_ASSET_MAX_BYTES. Confirm returned byte length equals
the discovered safe size. Reserve the destination through exclusive create.
Reuse compatible directories only inside the owned stage. Remove createdPaths,
attemptedFiles, and per-path rollback logic entirely.

- [ ] **Step 8: Thread ownership through the entire build**

Make OutputGeneratorOptions a discriminated dry-run/non-dry-run union. The
orchestrator passes publication.outputOwnership into generateAllOutputs.
copyAssets constructs StaticAssetCopyTarget and no longer receives outputDir
as write authority. Construct publication with the exact runtime filesystem
that setup/generation will use. Update build setup, CSS/image optimizers, MDX
directory compilation, and the embedded preset so none deletes, recreates, or
claims an arbitrary non-dry build root.

- [ ] **Step 9: Run GREEN and publication integration**

~~~bash
deno test --frozen --no-check --allow-all \
  src/build/production-build/build/build-publication.test.ts \
  src/build/production-build/build/build-setup.test.ts \
  src/build/production-build/asset-generation.test.ts \
  src/build/production-build/build/output-generator.test.ts \
  src/build/production-build/build/build-orchestrator.test.ts \
  src/build/production-build/static-generation.test.ts \
  src/build/asset-pipeline/css-optimizer/optimizer-service.test.ts \
  src/build/asset-pipeline/image-optimizer/optimizer-core.test.ts \
  src/build/compiler/mdx-compiler/directory-compiler.test.ts \
  src/build/embedded/preset.test.ts \
  tests/integration/server/build/asset-generation.test.ts \
  tests/integration/server/build/build.test.ts
git diff --check
~~~

- [ ] **Step 10: Commit and push**

~~~bash
git add src/build/production-build/build/build-publication.ts \
  src/build/production-build/build/build-publication.test.ts \
  src/build/production-build/build/build-setup.ts \
  src/build/production-build/build/build-setup.test.ts \
  src/build/production-build/asset-generation.ts \
  src/build/production-build/asset-generation.test.ts \
  src/build/production-build/build/output-generator.ts \
  src/build/production-build/build/output-generator.test.ts \
  src/build/production-build/build/build-orchestrator.ts \
  src/build/production-build/build/build-orchestrator.test.ts \
  src/build/asset-pipeline/css-optimizer/optimizer-service.ts \
  src/build/asset-pipeline/css-optimizer/optimizer-service.test.ts \
  src/build/asset-pipeline/image-optimizer/optimizer-core.ts \
  src/build/asset-pipeline/image-optimizer/optimizer-core.test.ts \
  src/build/compiler/mdx-compiler/directory-compiler.ts \
  src/build/compiler/mdx-compiler/directory-compiler.test.ts \
  src/build/embedded/preset.ts \
  src/build/embedded/preset.test.ts \
  tests/integration/server/build/asset-generation.test.ts \
  tests/integration/server/build/build.test.ts
git commit -m "feat(build): bind public assets to owned publication stages"
git push origin codex/module-reconcile-20260723
~~~

### Task 5: One Linear Nonce Scanner and Bounded Byte Transform

**Interfaces:**

~~~ts
export function transformHtmlNonceWithinLimit(
  source: Uint8Array,
  nonce: string | undefined,
  maximumBytes: number,
): Uint8Array;
~~~

nonce-lexical-scanner.ts exposes an internal incremental scanner that emits
unchanged spans and replacement spans through a callback. It stores only
lexical state and the incomplete suffix needed across stream chunks; it never
builds an array of all rewrites.

~~~ts
export type EmitSpan = (
  source: string,
  start: number,
  end: number,
  replacement?: string,
) => void;

export interface HtmlNonceScanner {
  push(chunk: string, flush: boolean, emit: EmitSpan): void;
}

export const MAX_NONCE_SCANNER_PENDING_CODE_UNITS = 1_048_576;

export function maximumNonceScannerTransitions(
  cumulativeInputCodeUnits: number,
): number;

export function createHtmlNonceScanner(
  escapedNonce: string,
): HtmlNonceScanner;
~~~

`maximumNonceScannerTransitions(n)` validates a non-negative safe integer and
returns exactly `2 * n + 1`, rejecting if that result would not be safe. Each
pass owns a fresh counter. Every loop iteration must either consume a previously
unconsumed UTF-16 code unit or perform one state/emission transition, so a pass
that exceeds this ceiling is a classified complexity failure. The incremental
scanner applies the formula to cumulative input and never rescans a retained
prefix.

- [ ] **Step 1: Add scanner RED tests**

Cover large ordinary text, comments, script/style raw text, comparison text,
mixed-case closing tags, incomplete tags, quoted greater-than signs, existing
nonce attributes, and tags split at every byte boundary. Assert ordinary text
is emitted in spans rather than one code unit per append. Assert the exact
`2 * n + 1` transition budget for adversarial incomplete inputs. An undecided
opening-tag lexeme at exactly 1,048,576 code units is admitted and one code unit
more fails. Comments and raw text must emit completed spans incrementally and
retain only their delimiter suffix, not their entire contents.

- [ ] **Step 2: Add bounded-byte RED tests**

Cover valid source with no nonce, malformed UTF-8, output exactly at
maximumBytes, output one byte over, a non-ASCII nonce, an existing longer nonce
shrinking the output, and poisoned TextEncoder/TextDecoder/Uint8Array globals
after module initialization. Add a deliberately no-progress internal state
case and assert the numeric transition guard stops it deterministically rather
than hanging.

- [ ] **Step 3: Run RED**

~~~bash
deno test --frozen --no-check --allow-all \
  src/html/nonce-lexical-scanner.test.ts \
  src/html/nonce-injection.test.ts
~~~

- [ ] **Step 4: Extract one scanner**

Represent state as data, for example:

~~~ts
type RawTextTag = "script" | "style" | null;

interface NonceScanState {
  rawTextTag: RawTextTag;
  pending: string;
}
~~~

Both addNonceToHtmlTags and addNonceToHtmlStream consume this scanner. Preserve
existing escaping and cancellation behavior. Make tag/comment/raw-text scans
monotonic so no input prefix is rescanned quadratically. Retain no more than
`MAX_NONCE_SCANNER_PENDING_CODE_UNITS` for one syntactic lexeme; emit comment
and raw-text contents as soon as they are no longer needed for delimiter
detection. Exceeding either the pending-code-unit or transition ceiling throws
the dedicated internal nonce-transform failure.

- [ ] **Step 5: Implement the two byte passes**

Capture fatal UTF-8 decoder, TextEncoder.encodeInto, typed-array constructors,
and accessors at module load. Decode once. First scan counts exact UTF-8 output
bytes with bounded scratch storage and rejects before output allocation. Second
scan writes into one exact fixed buffer with encodeInto. Any decode, scanner,
accounting, or write mismatch throws a dedicated internal nonce-transform
error.

- [ ] **Step 6: Run GREEN**

~~~bash
deno test --frozen --no-check --allow-all \
  src/html/nonce-lexical-scanner.test.ts \
  src/html/nonce-injection.test.ts \
  src/server/handlers/request/ssr/ssr-response-builder.test.ts
~~~

- [ ] **Step 7: Commit**

~~~bash
git add src/html/nonce-lexical-scanner.ts \
  src/html/nonce-lexical-scanner.test.ts \
  src/html/nonce-injection.ts \
  src/html/nonce-injection.test.ts
git commit -m "feat(html): bound nonce transformation by final bytes"
~~~

### Task 6: Exact Static Read Admission, HEAD Parity, and Error Mapping

**Interfaces:**

static-asset-admission.ts owns immutable read plans:

~~~ts
type StaticReadPlan =
  | {
    readonly kind: "snapshot";
    read(path: string, maximumBytes: number): Promise<Uint8Array>;
  }
  | {
    readonly kind: "virtual-exact";
    generation(): Promise<number>;
    read(path: string, maximumBytes: number): Promise<Uint8Array>;
  }
  | {
    readonly kind: "virtual-fixed-ceiling";
    readonly maximumBytes: number;
    generation(): Promise<number>;
    read(path: string): Promise<Uint8Array>;
  };

interface StaticReadAdmission {
  readonly plan: StaticReadPlan;
  readonly generationBeforeMetadata: number | null;
}
~~~

It also owns stat admission, intrinsic byte copying, and conversion from known
capability failures to the exact StaticAssetUnavailableReason union.

~~~ts
export async function beginStaticReadAdmission(
  fileSystem: FileSystemLike,
  maximumBytes: number,
): Promise<StaticReadAdmission>;

export function readStaticAssetBytes(
  admission: StaticReadAdmission,
  path: string,
  maximumBytes: number,
): Promise<Uint8Array>;

export function finishStaticHeadAdmission(
  admission: StaticReadAdmission,
): Promise<void>;
~~~

- [ ] **Step 1: Add read-plan RED tests**

Assert missing snapshot/exact authority, unrelated malformed methods,
accessor/Proxy capabilities, invalid stat booleans/size/mtime, RangeError,
FileSnapshotChangedError, dishonest reader results, and unexpected programmer
errors each take their exact branch. Unexpected errors must remain unexpected.
An adapter without `symlinkSemantics: "none"` may use only the root-bound
snapshot plan: exact-only and fixed-ceiling-only local adapters fail with
read-capability-unavailable. A virtual exact/fixed reader without a positive
safe generation method fails invalid-capability, and a changed generation
fails source-changed. A virtual fixed ceiling greater than the request maximum
is unavailable.

- [ ] **Step 2: Add GET/HEAD RED tests**

Assert GET admits exactly 64 MiB and rejects 64 MiB + 1 without requesting
67,108,865. A virtual read captures its generation before metadata and verifies
the same positive safe integer after the body. HEAD captures the same GET plan,
admits metadata between those generation checks, and never calls the body
reader. Non-HTML HEAD exposes only a safe known content length; HTML HEAD omits
it only when a request nonce would transform the representation. Reusable HTML
and non-HTML HEAD may expose an admitted safe stat content length; neither emits
a digest-derived ETag without reading the body.

- [ ] **Step 3: Add final-body and poisoning RED tests**

Assert nonce HTML that grows to exactly 64 MiB succeeds, one byte beyond returns
503, malformed UTF-8 returns 503, and BodyInit receives one tight fixed
ArrayBuffer after Uint8Array globals/prototypes and result view properties are
poisoned.

- [ ] **Step 4: Run RED**

~~~bash
deno test --frozen --no-check --allow-all \
  src/server/services/static/static-asset-admission.test.ts \
  src/server/services/static/static-file.service.test.ts \
  src/server/handlers/request/static.handler.test.ts
~~~

- [ ] **Step 5: Implement focused admission and service delegation**

Snapshot FileSystemLike methods once. First capture only the root-bound
snapshot reader; if it exists, do not inspect unrelated exact/whole/generation
fields. Only when it is absent may a virtual adapter with the safely captured
own data marker `symlinkSemantics: "none"` select an exact or fixed-whole reader,
and both require the same safely captured generation method. Capture a positive
safe generation before metadata and require exact equality after the GET read
or HEAD metadata admission. Resolve the selected plan during metadata
resolution so HEAD proves GET capability. For GET, pass exactly maxAssetBytes,
copy into a tight fixed buffer through captured intrinsics, and release raw
results. Keep not-found as candidate fallback. Do not catch unexpected faults.
Once this last consumer is migrated, remove captureFileSystemCapabilities and
its broad CapturedFileSystemCapabilities result; the final source tree exposes
only purpose-specific capture.

- [ ] **Step 6: Apply final HTML policy in StaticHandler**

Use transformHtmlNonceWithinLimit on admitted source bytes. A request-specific
nonce response gets Cache-Control: private, no-store and no ETag. It ignores
If-None-Match because no shared validator exists. Assert the digest function is
not invoked for this path. Non-HTML continues through the
reusable-representation path.

- [ ] **Step 7: Sanitize 503 behavior**

Catch only StaticAssetUnavailableError. Log pathname plus classified reason
only. Return status 503, Cache-Control: no-store, and the fixed public text
Static asset unavailable. Do not reflect adapter messages, raw values,
physical paths, or credentials.

- [ ] **Step 8: Run GREEN**

~~~bash
deno test --frozen --no-check --allow-all \
  src/server/services/static/static-asset-admission.test.ts \
  src/server/services/static/static-file.service.test.ts \
  src/server/handlers/request/static.handler.test.ts \
  src/utils/response-body.test.ts
~~~

- [ ] **Step 9: Commit**

~~~bash
git add src/server/services/static/static-asset-admission.ts \
  src/server/services/static/static-asset-admission.test.ts \
  src/server/services/static/static-file.service.ts \
  src/server/services/static/static-file.service.test.ts \
  src/server/services/static/index.ts \
  src/server/handlers/request/static.handler.ts \
  src/server/handlers/request/static.handler.test.ts \
  src/platform/adapters/file-system-capabilities.ts \
  src/platform/adapters/file-system-capabilities.test.ts
git commit -m "feat(server): admit exact final static representations"
~~~

### Task 7: SHA-256 ETags Across Server Callers

**Interfaces:**

computeEtag and computeStrongEtag become asynchronous SHA-256 functions.
computeEtag preserves its weak/strong argument for compatibility, but the
static service calls computeStrongEtag. The stable forms are:

~~~ts
W/"sha256-<unpadded-base64url>"
"sha256-<unpadded-base64url>"
~~~

hasMatchingEtag, parseIfNoneMatch, and matchesAnyEtag remain synchronous.

- [ ] **Step 1: Add cryptographic validator RED tests**

Assert known SHA-256 output, weak/strong syntax, deterministic string UTF-8 and
raw-byte handling, and that the legacy collision pair Ffaaaa and AAaaaa now
produce distinct validators. In the static-handler tests, assert SHA-256 is
computed only for reusable non-HTML final bytes and the digest seam is never
called for request-nonce HTML.

- [ ] **Step 2: Add hostile-global RED tests**

Import the module, replace crypto.subtle.digest, TextEncoder, Uint8Array,
Buffer, btoa, and base64 helper globals, then assert hashing still uses captured
intrinsics and stable dependency-free base64url output.

- [ ] **Step 3: Run RED**

~~~bash
deno test --frozen --no-check --allow-all \
  src/server/handlers/utils/etag.test.ts \
  src/utils/base64url.test.ts
~~~

- [ ] **Step 4: Implement SHA-256 and stable encoding**

Capture crypto.subtle.digest and text/byte intrinsics at module evaluation.
Reuse and, where necessary, harden src/utils/base64url.ts so byte-to-base64url
encoding does not depend on a live Buffer or btoa. Remove HASH_SEED_DJB2 from
etag.ts; do not retain a fallback.

- [ ] **Step 5: Migrate every caller to await**

Update static service, page module, page data, data endpoint, lib modules, SSR
etag handling/service, and studio bundle. Make computeSSRETag asynchronous when
it must hash HTML while preserving an externally supplied SSR hash as a
normalized weak tag.

- [ ] **Step 6: Run all ETag consumers GREEN**

~~~bash
deno test --frozen --no-check --allow-all \
  src/server/handlers/utils/etag.test.ts \
  src/server/handlers/request/module/page-module-handler.test.ts \
  src/server/handlers/request/module/page-data-endpoint-handler.test.ts \
  src/server/handlers/request/module/data-endpoint-handler.test.ts \
  src/server/handlers/request/lib-modules.handler.test.ts \
  src/server/handlers/request/ssr/etag-handler.test.ts \
  src/server/services/rendering/ssr.service.test.ts \
  src/server/handlers/studio/studio-bridge-bundle.test.ts \
  src/server/services/static/static-file.service.test.ts \
  src/server/handlers/request/static.handler.test.ts
~~~

- [ ] **Step 7: Prove the old hash is gone and commit**

~~~bash
! rg -n 'HASH_SEED_DJB2' src/server/handlers/utils/etag.ts
git diff --check
git add src/utils/base64url.ts src/utils/base64url.test.ts \
  src/server/handlers/utils/etag.ts \
  src/server/handlers/utils/etag.test.ts \
  src/server/services/static/static-file.service.ts \
  src/server/services/static/static-file.service.test.ts \
  src/server/handlers/request/static.handler.ts \
  src/server/handlers/request/static.handler.test.ts \
  src/server/handlers/request/module/page-module-handler.ts \
  src/server/handlers/request/module/page-module-handler.test.ts \
  src/server/handlers/request/module/page-data-endpoint-handler.ts \
  src/server/handlers/request/module/page-data-endpoint-handler.test.ts \
  src/server/handlers/request/module/data-endpoint-handler.ts \
  src/server/handlers/request/module/data-endpoint-handler.test.ts \
  src/server/handlers/request/lib-modules.handler.ts \
  src/server/handlers/request/lib-modules.handler.test.ts \
  src/server/handlers/request/ssr/etag-handler.ts \
  src/server/handlers/request/ssr/etag-handler.test.ts \
  src/server/services/rendering/ssr.service.ts \
  src/server/services/rendering/ssr.service.test.ts \
  src/server/handlers/studio/studio-bridge-bundle.ts \
  src/server/handlers/studio/studio-bridge-bundle.test.ts
git commit -m "refactor(server): replace 32-bit etags with sha256"
~~~

### Task 8: Linear JSON Preflight and Retained Manifest Index

**Interfaces:**

~~~ts
export interface ManifestJsonLimits {
  readonly maximumDepth: number;
  readonly maximumMembersAndItems: number;
  readonly maximumStringCodeUnits: number;
}

export const DEFAULT_MANIFEST_JSON_LIMITS = Object.freeze({
  maximumDepth: 64,
  maximumMembersAndItems: 250000,
  maximumStringCodeUnits: 8192,
});

export function preflightManifestJson(
  source: string,
  limits?: ManifestJsonLimits,
): void;

export interface ManifestIndex {
  getAsset(path: string): string | undefined;
  readonly retainedWeightBytes: number;
}

export function createManifestIndex(
  parsed: unknown,
  admittedWireBytes: number,
  schemaLimits?: ManifestAdmissionLimits,
): ManifestIndex;
~~~

- [ ] **Step 1: Add JSON preflight RED tests**

Cover depth 64/65, aggregate count 250,000/250,001, strings of 8,192/8,193
decoded UTF-16 code units, escaped Unicode, surrogate pairs, control
characters, unterminated strings, trailing tokens, deep malformed input, and a
boundary 32 MiB source. Assert the preflight is iterative and never calls
JSON.parse itself.

- [ ] **Step 2: Run RED**

~~~bash
deno test --frozen --no-check --allow-all \
  src/server/services/static/manifest-json-preflight.test.ts
~~~

- [ ] **Step 3: Implement a dependency-free lexical state machine**

Use a fixed maximum-64 frame stack with object/array expectation states. Count
one object member when its key/value pair begins and one array item when its
value begins. Count decoded JSON string code units: ordinary BMP input counts
one, a source surrogate pair counts two, and each valid unicode escape
contributes its decoded UTF-16 units. Reject malformed escapes and syntax
without recursion or substring accumulation. Limit overrides are test seams and
may only lower the three exported production maxima; reject an override that
raises any maximum.

- [ ] **Step 4: Add index/weight RED tests**

Move schema extraction tests from static-file.service.test.ts into
manifest-index.test.ts. Assert route/chunk/list/path limits remain unchanged,
duplicate normalized destinations remain deterministic, prototype/accessor
objects reject, and retained weight equals:

~~~ts
Math.max(
  admittedWireBytes,
  2 * sumOfRetainedKeyAndValueCodeUnits +
    128 * retainedMapEntryCount,
);
~~~

Use safe-integer checked addition and reject overflow.

- [ ] **Step 5: Implement and run GREEN**

Call preflightManifestJson before JSON.parse. Immediately validate the parsed
object into a minimal private Map and release raw text/object references. Expose
only a frozen getAsset closure plus retainedWeightBytes; do not return the
mutable Map under a ReadonlyMap type assertion.

~~~bash
deno test --frozen --no-check --allow-all \
  src/server/services/static/manifest-json-preflight.test.ts \
  src/server/services/static/manifest-index.test.ts
~~~

- [ ] **Step 6: Commit**

~~~bash
git add src/server/services/static/manifest-json-preflight.ts \
  src/server/services/static/manifest-json-preflight.test.ts \
  src/server/services/static/manifest-index.ts \
  src/server/services/static/manifest-index.test.ts
git commit -m "feat(server): preflight and weight static manifests"
~~~

### Task 9: Weighted Manifest Cache and Service Integration

**Interfaces:**

manifest-cache.ts owns one process-wide coordinator. Adapter/repository identity
is part of a record key; it never creates a separate resource budget:

~~~ts
interface ManifestCacheLimits {
  readonly maximumSettledEntries: number;
  readonly maximumWeightBytes: number;
  readonly maximumActiveLoads: number;
}

export const DEFAULT_MANIFEST_CACHE_LIMITS = Object.freeze({
  maximumSettledEntries: 128,
  maximumWeightBytes: 67108864,
  maximumActiveLoads: 2,
});

interface ManifestGeneration {
  readonly mtime: number | null;
  readonly size: number | null;
}

interface ManifestCacheRequest<T> {
  readonly identity: string;
  readonly generation: ManifestGeneration;
  readonly reservationBytes: number;
  load(): Promise<{
    readonly value: T;
    readonly wireBytes: number;
    readonly retainedWeightBytes: number;
    readonly publish: boolean;
  }>;
}

export interface ManifestCacheCoordinator {
  getOrLoad<T>(owner: object, request: ManifestCacheRequest<T>): Promise<T>;
  invalidate(owner: object, identity: string): void;
  invalidateOwner(owner: object): void;
  clear(): void;
}

export function createManifestCacheCoordinator(
  limits?: Partial<ManifestCacheLimits>,
): ManifestCacheCoordinator;

export const processManifestCacheCoordinator: ManifestCacheCoordinator;
~~~

Known safe nonzero size reserves that wire weight and becomes the snapshot read
limit. Known zero size reserves one byte and must return exactly zero. Unknown
size reserves and reads with 33,554,432.
Publication authority is separate from the active-slot and byte-reservation
leases. Retirement invalidates publication immediately, but both resource
leases remain charged until the underlying reader/parser actually settles. An
awaited cancellation may release them only after its finalizer proves local
buffers are no longer retained. Every lease releases exactly once.

The production singleton is internal to the static-service implementation and
is not re-exported from the public Server barrel. A WeakMap maps each stable
owner object to an opaque token; cache records retain only that token, not the
owner. The global settled LRU, active count, and combined
resident-plus-reserved weight cover every token. StaticFileService uses the
injected repository object, or otherwise the runtime adapter filesystem object,
as its stable owner. Injected cache limits and injected coordinators are
lower-ceiling test seams only. Production construction uses the exact constants
above, and normalization rejects a caller that raises entry, byte, or
active-load capacity.

- [ ] **Step 1: Add reservation/concurrency RED tests**

Assert two unique 32 MiB reservations succeed, a third unique request fails
immediately with manifest-capacity, and identical identity/generation requests
coalesce without taking a second slot. The three requests must use three
different owner objects so the test proves the two-slot and 64 MiB ceilings are
process-wide. Assert no wait queue exists.

- [ ] **Step 2: Add LRU/publication RED tests**

Cover 128 small settled identities distributed across at least three owners,
global deterministic least-recently-used eviction, same textual identity kept
separate between owners, wire versus retained weight, failed settled-weight
expansion, explicit in-flight retirement, stale completion unable to publish,
and release exactly once on success/failure/settled retirement. Add the
critical case: keep 32 MiB settled, start and retire a 32 MiB load without
settling it, then assert another 32 MiB load still fails capacity until the
retired work settles. Assert capacity eviction selects settled records only.
Call `clear()` with settled and in-flight records across multiple owners:
settled entries and weight disappear immediately, every publication token
retires, stale completions cannot publish, and each in-flight reservation/slot
remains charged until its underlying work settles.

- [ ] **Step 3: Run RED**

~~~bash
deno test --frozen --no-check --allow-all \
  src/server/services/static/manifest-cache.test.ts
~~~

- [ ] **Step 4: Implement the cache coordinator**

Use one module-level production coordinator, Map insertion order for its global
settled LRU, and module-private token records for owners,
reservations/publication. Before starting a unique load:

1. Return the exact matching in-flight promise when present.
2. Retire a replaced identity token without publishing it.
3. Require an active slot.
4. Evict settled LRU records until the wire reservation fits.
5. Fail immediately if it still cannot fit.
6. Reserve before calling the reader.

On completion, evict settled LRU as needed to exchange the reservation for
max(wireBytes, retainedWeightBytes). If exchange cannot fit, reject and publish
nothing. Invalidation changes only the publication token. Release the active
slot and reservation together in the underlying work's single settlement
finalizer, including for a retired record; never make its weight reusable merely
because its result can no longer publish.

Implement `clear()` as a process-wide barrier: retire every in-flight
publication token and drop every settled LRU record, but do not release an
in-flight resource lease early. Preserve `StaticFileService.clearCache()` by
delegating it to the production coordinator. Tests that inject a private
coordinator call that coordinator's clear method and never mutate the
production singleton.

- [ ] **Step 5: Add generation-bound manifest-read RED tests**

Require the rooted `readFileSnapshotWithinLimit` capability for manifest bytes.
For admitted known size `s > 0`, reserve `s` and call the snapshot with exactly
`s`; for known zero, reserve/call with one and require a zero-byte result; for
unknown size, reserve/call with exactly 33,554,432. Reserve before invoking the
reader. Returned wire bytes and post-stat size must exactly match a known
pre-stat size. If a known size below the global maximum raises RangeError or
returns a different length, classify source-changed; at the global/unknown
limit RangeError is byte-limit. A known size above 33,554,432 fails byte-limit
before reservation or reading. Missing, accessor-backed, Proxy, dishonest,
oversized, and source-changing readers map respectively to the exact approved
`read-capability-unavailable`, `invalid-capability`, `invalid-reader-result`,
`byte-limit`, and `source-changed` branches. An ordinary bounded reader is not a
fallback. Capture admitted stat metadata once before the snapshot and once
after; mismatch is source-changed,
not a recursive retry. A not-found manifest remains the existing candidate
fallback.

- [ ] **Step 6: Integrate StaticFileService under RED**

Add service cases for known/unknown size reservations, changed stat generation,
missing mtime coalescing without settled publication, malformed JSON before
JSON.parse amplification, not-found manifest, and exact mapping of parser/cache
failures to manifest-invalid/manifest-capacity. Decode snapshot bytes with the
captured fatal UTF-8 decoder, preflight before JSON.parse, and release source
bytes/text/parsed graphs once the minimal index is built.

- [ ] **Step 7: Complete the exact sanitized-error table**

Add one table-driven handler regression for every one of the nine exact
`StaticAssetUnavailableReason` values. Each returns status 503, body
`Static asset unavailable.`, and `Cache-Control: no-store`, while logs contain
only the safe request pathname plus reason. Adapter messages, credentials, and
physical paths must be absent. A separate unexpected-error row must reject out
of the handler rather than being mislabeled as a 503.

- [ ] **Step 8: Split the oversized service**

StaticFileService keeps candidate and cache-strategy orchestration. It delegates
JSON admission/indexing to manifest-index and lifecycle accounting to
the process manifest coordinator. Delete the old manifestCache,
manifestLoading, accessOrder, recursive stat/read/stat retry, and
claimManifestCacheSlot fields/methods.

- [ ] **Step 9: Run GREEN and combined static tests**

~~~bash
deno test --frozen --no-check --allow-all \
  src/server/services/static/manifest-json-preflight.test.ts \
  src/server/services/static/manifest-index.test.ts \
  src/server/services/static/manifest-cache.test.ts \
  src/server/services/static/static-file.service.test.ts \
  src/server/handlers/request/static.handler.test.ts
deno check --frozen \
  src/server/services/static/index.ts \
  src/server/index.ts
~~~

- [ ] **Step 10: Commit and push**

~~~bash
git add src/server/services/static/manifest-cache.ts \
  src/server/services/static/manifest-cache.test.ts \
  src/server/services/static/static-file.service.ts \
  src/server/services/static/static-file.service.test.ts \
  src/server/services/static/index.ts \
  src/server/handlers/request/static.handler.ts \
  src/server/handlers/request/static.handler.test.ts
git commit -m "feat(server): bound static manifest residency and concurrency"
git push origin codex/module-reconcile-20260723
~~~

At this clean checkpoint fetch origin. If origin/main moved, merge it, resolve
only real conflicts, rerun Tasks 1-9 focused gates, then push the merge.

### Task 10: Browser-Only Diagnostics and Escaping

**Interfaces:**

~~~ts
export function snapshotBrowserThrowableDiagnostic(
  value: unknown,
): string;
~~~

Authentic Error values contribute only an own data-property string message.
Primitive values use captured String. Objects/functions, accessors, proxies,
name, stack, cause, and retained references are ignored. The output is capped
at 2,048 code units.

- [ ] **Step 1: Add browser diagnostic RED tests**

Cover ordinary Error, accessor-backed message, inherited message, Proxy Error,
Symbol, BigInt, throwing primitive coercion, objects/functions, huge message,
and poisoned Error/String/Object globals after module import. Assert no hook is
invoked and the returned value is detached/bounded.

- [ ] **Step 2: Add page-loader graph RED test**

Assert every throwable snapshot in page-loader uses the browser helper and a
fresh router and prefetch bundle cannot reach errors/safe-diagnostics.ts,
platform/compat/error-introspection.ts, or node:util/types. Put the dependency-
closure regression in `src/build/production-build/client-runtime.test.ts`; use
the injected bundler input/metafile seam rather than treating the existing
server-directive AST test as proof of the client graph.

- [ ] **Step 3: Run RED**

~~~bash
deno test --frozen --no-check --allow-all \
  src/errors/browser-error.test.ts \
  src/routing/client/page-loader.test.ts \
  src/build/production-build/client-runtime.test.ts \
  src/server/shared/browser-module-boundary.test.ts
~~~

- [ ] **Step 4: Implement and migrate**

Build snapshotBrowserThrowableDiagnostic beside ensureBrowserError from already
captured browser intrinsics. Replace all six page-loader diagnostic calls.
Point security/client/html-sanitizer.ts and
rendering/client/prefetch/resource-hints.ts at
#veryfront/utils/html-escape.ts. Keep server html/error-registry behavior
unchanged.

- [ ] **Step 5: Run GREEN**

~~~bash
deno test --frozen --no-check --allow-all \
  src/errors/browser-error.test.ts \
  src/routing/client/page-loader.test.ts \
  src/security/client/html-sanitizer.test.ts \
  src/rendering/client/prefetch/resource-hints.test.ts \
  src/build/production-build/client-runtime.test.ts \
  src/server/shared/browser-module-boundary.test.ts
~~~

- [ ] **Step 6: Commit**

~~~bash
git add src/errors/browser-error.ts src/errors/browser-error.test.ts \
  src/routing/client/page-loader.ts src/routing/client/page-loader.test.ts \
  src/build/production-build/client-runtime.test.ts \
  src/security/client/html-sanitizer.ts \
  src/security/client/html-sanitizer.test.ts \
  src/rendering/client/prefetch/resource-hints.ts \
  src/rendering/client/prefetch/resource-hints.test.ts
git commit -m "refactor(browser): detach diagnostics from server internals"
~~~

### Task 11: Snapshot Client Sources and Reject Every node: Edge

**Interfaces:**

Client source onLoad calls:

~~~ts
snapshotReader.read(
  candidatePath,
  physicalPackageRoot,
  4 * 1024 * 1024,
);
~~~

The resolver rejects node: before generic external handling. It applies to
import-statement, dynamic-import, export-from, require-call, and transitive
internal aliases.

- [ ] **Step 1: Add node-specifier RED tests**

Drive the resolver plugin with static import, dynamic import, export-from, and
transitive internal files containing node:util/types and node:fs. Assert each
throws BUILD_FAILED naming only the safe specifier/category. Assert approved
React externals remain external.

- [ ] **Step 2: Add source-race RED tests**

Replace a source after candidate discovery and before onLoad, replace a symlink
target, change generation during read, return invalid UTF-8, and exceed 4 MiB.
Assert none can fall through to another loader or ordinary pathname read.

- [ ] **Step 3: Run RED**

~~~bash
deno test --frozen --no-check --allow-all \
  src/build/production-build/client-runtime.test.ts
~~~

- [ ] **Step 4: Implement fail-closed resolution**

Remove node: from the generic externalSpecifier branch. Reject it first in
onResolve for every import kind. Keep std, deno, and HTTP policy explicit and
unchanged. Add a final generated-output assertion for unresolved internal
aliases and node: module specifiers.

- [ ] **Step 5: Replace precheck/reopen source reads**

Candidate discovery may check existence, but onLoad must acquire bytes only
through readFileSnapshotWithinLimit with physicalPackageRoot. Remove the
lstat/realPath/readFileBytesWithinLimit sequence as source authority. Map
missing capability, source change, overflow, malformed result, and invalid
UTF-8 to safe BUILD_FAILED details.

- [ ] **Step 6: Run GREEN and boundary gates**

~~~bash
deno test --frozen --no-check --allow-all \
  src/build/production-build/client-runtime.test.ts \
  scripts/build/prebundle-rsc-scripts.test.ts \
  src/server/shared/browser-module-boundary.test.ts
deno task lint:core-deps
deno task lint:dependency-boundaries
deno task lint:module-boundaries
~~~

- [ ] **Step 7: Commit**

~~~bash
git add src/build/production-build/client-runtime.ts \
  src/build/production-build/client-runtime.test.ts
git commit -m "feat(build): fence browser sources and reject node modules"
~~~

### Task 12: Deterministic Templates and Real Chromium Artifacts

**Interfaces:**

The permanent browser test must serve files produced by the production client
output path, use the default production import map, execute the exported router
boot and prefetch initializer, and fail on:

- browser console error or warning;
- pageerror or unhandled rejection;
- failed request;
- any node: URL request;
- missing boot marker; or
- source/embedded bundle mismatch.

- [ ] **Step 1: Add generated freshness RED checks**

Before regeneration, run the check form and confirm templates.ts is stale for
the intended browser-graph changes:

~~~bash
deno run --frozen -A scripts/build/prebundle-client-scripts.ts --check
~~~

The `client-runtime.test.ts` graph tests from Tasks 10-11 must prove a successful
fresh generation contains no unresolved internal alias and no node: module
edge.

- [ ] **Step 2: Add the Chromium regression under RED**

Use tests/_helpers/playwright.ts. Generate the real app.js, router.js,
prefetch.js, client.js, and hydration files into a temporary owned build
stage, publish it, and serve the final directory plus a minimal HTML shell
containing the exact default production import map. Deterministically intercept
the import map's React/ReactDOM CDN target URLs with small local ESM fixtures so
the test does not depend on public network availability while preserving the
real default mappings. Import router and prefetch entry points, call boot, and
set a deterministic DOM/global completion marker.

The helper's absent-browser result is not a skip. Assert it is non-null and
throw `Chromium is required for the production artifact release gate` before
entering the test body if no executable is available.

- [ ] **Step 3: Run RED**

~~~bash
deno test --frozen --no-check --allow-all \
  tests/e2e/regressions/2026-08-01-production-client-artifacts.test.ts
~~~

Expected before the graph fix/template regeneration: a node: link failure or
fresh-to-embedded mismatch. If Chromium is absent, install it in the verification
environment; a skip is not a release green.

- [ ] **Step 4: Regenerate and account for every generator output**

~~~bash
deno run --frozen -A scripts/build/prebundle-client-scripts.ts
git diff --exit-code -- src/server/handlers/dev/framework-candidates.generated.ts
~~~

The script also emits
`src/server/handlers/dev/framework-candidates.generated.ts`. The browser-graph
change must leave that artifact byte-identical; a diff is a blocker to
investigate, not an unrelated file to stage. Review templates.ts as a generated
artifact, not hand-written source. Confirm router and prefetch embedded strings
exactly equal fresh generation.

- [ ] **Step 5: Run GREEN**

~~~bash
deno test --frozen --no-check --allow-all \
  src/build/production-build/client-runtime.test.ts \
  src/build/production-build/templates.test.ts \
  tests/e2e/regressions/2026-08-01-production-client-artifacts.test.ts
deno run --frozen -A scripts/build/prebundle-client-scripts.ts --check
deno test --frozen --no-check --allow-all \
  scripts/build/framework-candidates.test.ts \
  src/server/handlers/dev/framework-candidates.generated.test.ts
~~~

- [ ] **Step 6: Commit and push**

~~~bash
git add src/build/production-build/templates.ts \
  src/build/production-build/templates.test.ts \
  tests/e2e/regressions/2026-08-01-production-client-artifacts.test.ts
git commit -m "test(build): prove generated client artifacts in chromium"
git push origin codex/module-reconcile-20260723
~~~

### Task 13: Migration Documentation, Generated References, and Release Gate

- [ ] **Step 1: Write adapter migration documentation**

Document both raw semantic signatures, positive-safe-integer limits,
RangeError/source-change behavior, immutable virtual generation proof,
purpose-specific capture, and deliberate omission when proof is unavailable.
Include before/after adapter examples without suggesting an ordinary-read
fallback. Name `veryfront/fs` as the supported public import for
`FileSnapshotChangedError` and its predicate. Update both platform READMEs and
the runtime-adapters architecture document.

- [ ] **Step 2: Update build/server deployment guidance**

Document opaque stage ownership, exclusive creation, whole-stage cleanup,
64 MiB final BodyInit, GET/HEAD differences, nonce private/no-store behavior,
SHA-256 validators, manifest budgets, sanitized 503 reasons, and CDN/object
delivery through extensions for larger assets. Update the Server runtime and
build-pipeline architecture documents as well as the deployment guide.

- [ ] **Step 3: Add breaking-release guidance**

In the migration guide and relevant READMEs state that adapters relying on
whole-file reads or overwrite writes no longer support affected production
build paths until they implement the semantic capability. There is no hidden
compatibility switch.

- [ ] **Step 4: Validate handwritten docs before generation**

~~~bash
deno run --allow-read scripts/docs/validate-guides.ts
deno run --allow-read scripts/docs/validate-public-docs.ts
deno test --no-check --allow-all \
  tests/docs/guide-examples.test.ts \
  tests/docs/guide-code-examples.test.ts
deno run -A scripts/lint/check-doc-links.ts
~~~

- [ ] **Step 5: Regenerate API references intentionally**

~~~bash
deno task docs
deno task docs:generated:check
~~~

Stage only the API reference files whose exported source changed. Do not stage
unrelated generated drift.

- [ ] **Step 6: Commit documentation at a clean checkpoint**

~~~bash
git add src/platform/README.md \
  src/platform/adapters/README.md \
  src/build/production-build/README.md \
  src/server/README.md \
  docs/architecture/04-server-runtime.md \
  docs/architecture/14-build-pipeline.md \
  docs/architecture/15-runtime-adapters.md \
  docs/guides/deploying.md \
  docs/guides/index.md \
  docs/guides/filesystem-adapter-migration.md \
  docs/api-reference/veryfront/errors.md \
  docs/api-reference/veryfront/fs.md \
  docs/api-reference/veryfront/router.md \
  docs/api-reference/veryfront/security.md \
  docs/api-reference/veryfront/server.md \
  docs/api-reference/veryfront/utils.md
git commit -m "docs(server): document static runtime hardening"
git push origin codex/module-reconcile-20260723
~~~

Inspect each listed generated reference before staging and omit it if its bytes
did not change. No unrelated generated file, `src/extensions/scaffold/`, or
unexplained `deno.lock` change may enter the commit.

- [ ] **Step 7: Integrate origin/main before final verification**

Require a clean tracked tree first. Because core adds no dependency, an
unexplained lockfile diff is not regenerated as a side effect: compare it with
the branch and origin/main, identify its owner, and resolve it deliberately.
Then:

~~~bash
git fetch origin
git merge --no-edit origin/main
git push origin codex/module-reconcile-20260723
~~~

Resolve only real conflicts using the approved contracts. If merged inputs make
a generated artifact stale, regenerate it intentionally, review it, and commit
that exact artifact before continuing. Every remaining gate below runs on this
merged tree.

- [ ] **Step 8: Run the focused combined Server gate**

~~~bash
deno test --frozen --no-check --allow-all \
  src/platform/adapters/file-system-capabilities.test.ts \
  src/platform/adapters/index.test.ts \
  src/fs/index.test.ts \
  src/platform/adapters/runtime/shared/node-filesystem-adapter.test.ts \
  src/platform/adapters/runtime/node/filesystem-adapter.test.ts \
  src/platform/adapters/runtime/deno/filesystem-adapter.test.ts \
  src/platform/adapters/runtime/bun/filesystem-adapter.test.ts \
  src/platform/compat/fs.test.ts \
  src/platform/adapters/fs/wrapper.test.ts \
  src/security/secure-fs.test.ts \
  src/repositories/repositories.test.ts \
  src/build/production-build/build/build-publication.test.ts \
  src/build/production-build/build/build-setup.test.ts \
  src/build/production-build/asset-generation.test.ts \
  src/build/production-build/build/output-generator.test.ts \
  src/build/production-build/build/build-orchestrator.test.ts \
  src/build/asset-pipeline/css-optimizer/optimizer-service.test.ts \
  src/build/asset-pipeline/image-optimizer/optimizer-core.test.ts \
  src/build/compiler/mdx-compiler/directory-compiler.test.ts \
  src/build/embedded/preset.test.ts \
  src/html/nonce-lexical-scanner.test.ts \
  src/html/nonce-injection.test.ts \
  src/server/handlers/utils/etag.test.ts \
  src/server/services/static/static-asset-admission.test.ts \
  src/server/services/static/manifest-json-preflight.test.ts \
  src/server/services/static/manifest-index.test.ts \
  src/server/services/static/manifest-cache.test.ts \
  src/server/services/static/static-file.service.test.ts \
  src/server/handlers/request/static.handler.test.ts \
  src/errors/browser-error.test.ts \
  src/routing/client/page-loader.test.ts \
  src/build/production-build/client-runtime.test.ts \
  src/build/production-build/templates.test.ts \
  tests/integration/server/build/asset-generation.test.ts \
  tests/integration/server/build/build.test.ts \
  tests/integration/server/production/static.test.ts \
  tests/e2e/regressions/2026-08-01-production-client-artifacts.test.ts
~~~

- [ ] **Step 9: Run structural, documentation, and generated gates**

~~~bash
deno task generate:manifests:check
deno run --frozen -A scripts/build/prebundle-client-scripts.ts --check
deno task fmt:check
deno task lint
deno task lint:style
deno task lint:core-deps
deno task lint:core-deps:strict
deno task lint:dependency-boundaries
deno task lint:module-boundaries
deno task lint:extension-contracts
deno task lint:extension-capabilities
deno task docs:validate
deno task docs:generated:check
deno task typecheck
deno task typecheck:extensions
git diff --check
~~~

- [ ] **Step 10: Run the canonical, cross-runtime, and browser gates**

~~~bash
deno task verify
deno task test:cross-runtime
deno task test:node
deno task test:bun
deno task test:e2e:rsc-browser
~~~

Record unavailable optional runtimes explicitly. Do not describe an unavailable
runtime or Chromium as passing. The dedicated Node 18.18 lane and real Bun and
Chromium jobs must be green in CI before Server closes.

- [ ] **Step 11: Review the complete diff**

Run targeted searches:

~~~bash
rg -n 'readFileSnapshotWithinLimit|createFileBytesExclusive' src docs
rg -n 'computeEtag|computeStrongEtag' src/server
rg -n 'HASH_SEED_DJB2' src/server/handlers/utils/etag.ts
rg -n 'node:' src/build/production-build/templates.ts
git status --short
git diff --stat
git diff --check
~~~

Confirm the StaticAssetUnavailableReason union is exact, constants are central,
no complete-read-and-slice fallback exists, no per-path asset rollback remains,
and core added no third-party import.

- [ ] **Step 12: Commit any gate-driven fixes and repeat verification**

Any source or generated fix discovered by Steps 8-11 gets its own exact-path
commit. Then repeat all of Steps 8-11; do not report only the previously green
subset. Fetch origin once more. If origin/main moved since Step 7, merge it and
repeat all of Steps 8-11 again. When the final merged tree is green:

~~~bash
git push origin codex/module-reconcile-20260723
git status --short --branch
~~~

The final status must contain no unexplained tracked change. Never stage
`src/extensions/scaffold/` or regenerate `deno.lock` unless the reviewed final
dependency graph intentionally changed.

## Completion Evidence

Server closes only when all of the following are attached to the final report:

- each task's observed RED and subsequent GREEN;
- final commit hashes and pushed branch head;
- clean generated-template and API-reference checks;
- Deno, Node, Bun, and Chromium results or explicit unavailable-runtime gaps;
- core dependency and all boundary audit results;
- final origin/main integration base;
- confirmation that the previous published output survives failed build
  generation/promotion;
- confirmation that runtime failure emits neither a partial nor over-limit
  body; and
- independent final code review with no unresolved production-grade blocker.
