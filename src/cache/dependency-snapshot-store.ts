/**
 * Opt-in cache-backed dependency snapshot storage for trusted host bootstrap.
 * The host places the handle on its runtime adapter before requests begin.
 * The framework does not activate this provider itself; unconfigured runtimes
 * retain process-local history and shared metadata-history recovery.
 *
 * This provider is incomplete for production shared storage. Unconditional
 * writes followed by verification cannot guarantee immutable publication across
 * replicas. Optional revision methods require the reserved revisioned key format,
 * and fail-soft backend reads cannot distinguish an outage from missing history.
 * These paths must satisfy the DependencySnapshotStore contract before activation.
 *
 * Captured intrinsics protect the specific private-capability paths covered by
 * tests. The opaque handle does not provide a sandbox for privileged credentials;
 * the host must isolate privileged storage from project execution.
 */
import {
  createDependencySnapshotStoreHandle,
  type DependencySnapshotRecord,
  type DependencySnapshotStore,
  type DependencySnapshotStoreHandle,
} from "#veryfront/platform/adapters/dependency-snapshot-store.ts";
import type { CacheBackend } from "./types.ts";
import { createCacheBackend, createDistributedCacheAccessor } from "./backends/factory.ts";
import { captureRevisionedCacheBackendMethods } from "./capabilities.ts";
import { assertCacheValueWithinLimit, captureBoundedCacheRead } from "./bounded-read.ts";

const apply = Reflect.apply;
const jsonParse = JSON.parse;
const jsonStringify = JSON.stringify;
const dateNow = Date.now;
const mathCeil = Math.ceil;
const isSafeInteger = Number.isSafeInteger;
const isArray = Array.isArray;

const SNAPSHOT_KEY_PREFIX = "dependency-snapshots";

/** The store contract bounds snapshot payloads to 1 MiB. */
const MAX_SNAPSHOT_VALUE_BYTES = 1_048_576;

/**
 * The record embeds the payload as a JSON string. Snapshot payloads are
 * themselves JSON text (see `encodeDependencySnapshot`), so they carry no raw
 * control characters and worst-case escaping doubles quotes and backslashes.
 * Twice the payload bound plus envelope room admits every valid payload.
 */
const MAX_SNAPSHOT_RECORD_BYTES = 2 * MAX_SNAPSHOT_VALUE_BYTES + 4_096;

/**
 * Deadline tolerance for concurrent same-value publications. Two replicas
 * publishing an identical snapshot stamp deadlines milliseconds apart, and
 * either write order must acknowledge both. A silently dropped renewal keeps a
 * deadline hours short of the requested one, far outside this slack. The
 * residual cost of the tolerance is bounded by its size: shared history can
 * expire at most this much earlier than an acknowledged deadline, and the
 * registry renews snapshots half a retention period (hours) before expiry, so
 * a sub-minute shortfall never outlives the next renewal.
 */
const RENEWAL_DEADLINE_SLACK_MS = 60_000;

/** Reject promptly on an aborted operation; backend calls are not cancelable. */
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error("Dependency snapshot store operation was aborted");
  }
}

function recordKey(namespace: string, key: string): string {
  return `${namespace}:${key}`;
}

function decodeRecord(raw: string): DependencySnapshotRecord {
  let parsed: unknown;
  try {
    parsed = jsonParse(raw);
  } catch {
    throw new Error("Dependency snapshot record is not valid JSON");
  }
  if (parsed === null || typeof parsed !== "object" || isArray(parsed)) {
    throw new Error("Dependency snapshot record must be an object");
  }
  const { value, expiresAt } = parsed as Record<string, unknown>;
  if (typeof value !== "string" || !isSafeInteger(expiresAt)) {
    throw new Error("Dependency snapshot record fields are malformed");
  }
  assertCacheValueWithinLimit(value, MAX_SNAPSHOT_VALUE_BYTES);
  return { value, expiresAt: expiresAt as number };
}

/** Read a raw record without materializing an unbounded backend value. */
async function readRecordRaw(backend: CacheBackend, cacheKey: string): Promise<string | null> {
  const bounded = captureBoundedCacheRead(backend);
  if (bounded) {
    const value = await bounded.getWithinLimit(cacheKey, MAX_SNAPSHOT_RECORD_BYTES);
    if (value === null) return null;
    assertCacheValueWithinLimit(value, MAX_SNAPSHOT_RECORD_BYTES);
    return value;
  }
  // Redis exposes no bounded read; the post-hoc assertion still refuses to
  // decode or serve an oversized record.
  const get = backend.get;
  const value = await apply(get, backend, [cacheKey]);
  if (value !== null) assertCacheValueWithinLimit(value, MAX_SNAPSHOT_RECORD_BYTES);
  return value;
}

function retainedDeadlineCovers(retained: number, requested: number): boolean {
  return retained + RENEWAL_DEADLINE_SLACK_MS >= requested;
}

/**
 * Build a `DependencySnapshotStore` over a cache backend accessor. The accessor
 * resolving `null` means storage is unavailable, and every operation rejects ,
 * unavailable history must never read as missing history or cached success.
 */
export function createCacheBackedDependencySnapshotStore(
  getBackend: () => Promise<CacheBackend | null>,
): DependencySnapshotStore {
  async function requireBackend(): Promise<CacheBackend> {
    const backend = await getBackend();
    if (!backend) throw new Error("Dependency snapshot cache backend is unavailable");
    return backend;
  }

  async function verifyRetained(
    backend: CacheBackend,
    cacheKey: string,
    value: string,
    expiresAt: number,
  ): Promise<void> {
    const writtenRaw = await readRecordRaw(backend, cacheKey);
    const written = writtenRaw === null ? null : decodeRecord(writtenRaw);
    if (written?.value !== value || !retainedDeadlineCovers(written.expiresAt, expiresAt)) {
      throw new Error("Dependency snapshot publication was not retained");
    }
  }

  return {
    publish: async (namespace, key, value, expiresAt, signal) => {
      throwIfAborted(signal);
      assertCacheValueWithinLimit(value, MAX_SNAPSHOT_VALUE_BYTES);
      const backend = await requireBackend();
      const cacheKey = recordKey(namespace, key);
      const revisioned = captureRevisionedCacheBackendMethods(backend);

      const existingRaw = revisioned === null ? await readRecordRaw(backend, cacheKey) : undefined;
      const observed = revisioned === null
        ? undefined
        : await apply(revisioned.getWithRevision, backend, [cacheKey]);
      const observedRaw = revisioned === null ? existingRaw : observed!.value;
      if (observedRaw !== null && observedRaw !== undefined) {
        assertCacheValueWithinLimit(observedRaw, MAX_SNAPSHOT_RECORD_BYTES);
        const existing = decodeRecord(observedRaw);
        if (existing.value !== value) {
          throw new Error("Dependency snapshot key already holds different bytes");
        }
        if (existing.expiresAt >= expiresAt) return;
      }
      throwIfAborted(signal);

      const ttlSeconds = mathCeil((expiresAt - dateNow()) / 1000);
      if (ttlSeconds <= 0) {
        throw new Error("Dependency snapshot retention window has already passed");
      }
      // Null prototype: an installed Object.prototype.toJSON must never see
      // the record or alter its serialization.
      const encoded = jsonStringify({ __proto__: null, value, expiresAt });

      if (revisioned !== null) {
        const accepted = await apply(revisioned.compareExchange, backend, [
          cacheKey,
          observed!.revision,
          { kind: "set", value: encoded, expiresAtMs: expiresAt },
        ]);
        if (accepted) return;
        // Lost the race: acknowledge only if the winner published the same
        // bytes with a deadline that still covers this request.
        const currentRaw = await readRecordRaw(backend, cacheKey);
        const current = currentRaw === null ? null : decodeRecord(currentRaw);
        if (current?.value === value && retainedDeadlineCovers(current.expiresAt, expiresAt)) {
          return;
        }
        throw new Error("Dependency snapshot publication lost a conflicting race");
      }

      // Without the revision capability the write itself is unconditional, and
      // read-back verification cannot serialize two publishers. That residual
      // race never surfaces legitimate divergence: a snapshot value is the
      // canonical serialization of exactly the state hashed into its key
      // (encodeDependencySnapshot sorts and canonicalizes), so concurrent
      // publishers at one key carry identical bytes unless storage is
      // corrupted, and corruption is what the checks above still catch.
      const set = backend.set;
      await apply(set, backend, [cacheKey, encoded, ttlSeconds]);
      // The backends fail open on `set`, and acknowledged retention is the
      // whole point of publication: a document only advertises a pin its
      // replicas can later resolve. Verify the bytes and the deadline landed.
      await verifyRetained(backend, cacheKey, value, expiresAt);
    },

    read: async (namespace, key, signal) => {
      throwIfAborted(signal);
      const backend = await requireBackend();
      const raw = await readRecordRaw(backend, recordKey(namespace, key));
      if (raw === null) return null;
      const record = decodeRecord(raw);
      // The contract reserves null for missing or expired history; a backend
      // that retains stale bytes past their TTL must not resurrect them.
      if (record.expiresAt <= dateNow()) return null;
      return record;
    },
  };
}

/**
 * Resolve the shared snapshot cache backend, rejecting node-local fallbacks.
 * A rejection (rather than a memory/disk substitute) keeps
 * `createDistributedCacheAccessor`'s failure-retry path armed, so an outage at
 * initialization time heals once the shared backend recovers.
 * @internal Exported for tests.
 */
export async function _createSharedDependencySnapshotCacheBackend(): Promise<CacheBackend> {
  const backend = await createCacheBackend({ keyPrefix: SNAPSHOT_KEY_PREFIX });
  if (backend.type !== "api" && backend.type !== "redis") {
    throw new Error(
      "Shared dependency snapshot storage requires the API cache or Redis backend",
    );
  }
  return backend;
}

/**
 * Build the opaque handle for cache-backed shared snapshot history.
 *
 * Calling this is the host's explicit decision to use the distributed cache as
 * snapshot storage; the framework never calls it on its own. The host bootstrap
 * that owns the runtime adapter places the handle on the adapter before its
 * first request, per `docs/architecture/15-runtime-adapters.md`:
 *
 * ```ts
 * import { createCacheDependencySnapshotStoreHandle, type RuntimeAdapter } from "veryfront/platform";
 *
 * export function configureSnapshotHistory(adapter: RuntimeAdapter): void {
 *   Object.defineProperty(adapter, "dependencySnapshotStore", {
 *     value: createCacheDependencySnapshotStoreHandle(),
 *   });
 * }
 * ```
 *
 * The handle's operations reject while no qualifying shared backend (API cache
 * or Redis) is resolvable, and the underlying accessor retries resolution on
 * its normal failure-backoff schedule.
 */
export function createCacheDependencySnapshotStoreHandle(): DependencySnapshotStoreHandle {
  const accessor = createDistributedCacheAccessor(
    _createSharedDependencySnapshotCacheBackend,
    "DEPENDENCY-SNAPSHOTS",
  );
  return createDependencySnapshotStoreHandle(
    createCacheBackedDependencySnapshotStore(accessor),
  );
}
