/**
 * Shared dependency snapshot storage over the distributed cache backend.
 *
 * The dependency snapshot registry (`transforms/esm/dependency-snapshot-registry.ts`)
 * shares pinned dependency history across renderer replicas through the
 * `DependencySnapshotStore` capability. Without it, history is process-local:
 * a document rendered on one replica pins a snapshot key that another replica
 * cannot resolve once dependency writeback rewrites `package.json`, and every
 * pinned module request landing there answers 409 until the client re-renders
 * against the new key.
 *
 * This module implements that capability over the same shared cache backends
 * the module response caches already use (API cache or Redis). Only genuinely
 * shared backends qualify: the contract explicitly excludes node-local storage,
 * so disk and memory backends never serve as snapshot history — a degraded
 * resolution rejects, keeping the accessor's failure-retry path live so a
 * recovered Redis is picked back up without a process restart.
 *
 * Failure semantics follow the store contract: publication resolves only after
 * the backend demonstrably retains the exact bytes until the requested deadline
 * (the backends fail open on `set`, so publication re-reads and verifies), and
 * different bytes at an already-published key fail rather than overwrite —
 * atomically where the backend exposes the revision capability, and by
 * read-back verification elsewhere. Reads are bounded before materializing a
 * record; a fail-open backend read that reports an outage as a miss degrades to
 * a snapshot conflict, never to wrong data.
 */
import {
  createDependencySnapshotStoreHandle,
  type DependencySnapshotRecord,
  type DependencySnapshotStore,
  type DependencySnapshotStoreHandle,
} from "#veryfront/platform/adapters/dependency-snapshot-store.ts";
import type { CacheBackend } from "./types.ts";
import {
  createCacheBackend,
  createDistributedCacheAccessor,
  isApiCacheAvailable,
} from "./backends/factory.ts";
import { isRedisConfigured } from "./backends/redis.ts";
import { captureRevisionedCacheBackendMethods } from "./capabilities.ts";
import { assertCacheValueWithinLimit, captureBoundedCacheRead } from "./bounded-read.ts";

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
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Dependency snapshot record is not valid JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Dependency snapshot record must be an object");
  }
  const { value, expiresAt } = parsed as Record<string, unknown>;
  if (typeof value !== "string" || !Number.isSafeInteger(expiresAt)) {
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
  const value = await backend.get(cacheKey);
  if (value !== null) assertCacheValueWithinLimit(value, MAX_SNAPSHOT_RECORD_BYTES);
  return value;
}

function retainedDeadlineCovers(retained: number, requested: number): boolean {
  return retained + RENEWAL_DEADLINE_SLACK_MS >= requested;
}

/**
 * Build a `DependencySnapshotStore` over a cache backend accessor. The accessor
 * resolving `null` means storage is unavailable, and every operation rejects —
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
        : await Reflect.apply(revisioned.getWithRevision, backend, [cacheKey]);
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

      const ttlSeconds = Math.ceil((expiresAt - Date.now()) / 1000);
      if (ttlSeconds <= 0) {
        throw new Error("Dependency snapshot retention window has already passed");
      }
      const encoded = JSON.stringify({ value, expiresAt });

      if (revisioned !== null) {
        const accepted = await Reflect.apply(revisioned.compareExchange, backend, [
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
      // corrupted — and corruption is what the checks above still catch.
      await backend.set(cacheKey, encoded, ttlSeconds);
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
      if (record.expiresAt <= Date.now()) return null;
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

/** Only backends shared across replicas satisfy the snapshot store contract. */
function isSharedBackendConfigured(): boolean {
  return isApiCacheAvailable() || isRedisConfigured();
}

let testBackendAccessor: (() => Promise<CacheBackend | null>) | undefined;
let sharedHandle: DependencySnapshotStoreHandle | undefined;
let sharedAccessor: (() => Promise<CacheBackend | null>) | undefined;

/**
 * The process-wide shared snapshot store handle, or `undefined` when no shared
 * cache backend is configured (local development keeps process-local history).
 * The handle is created lazily and reused for the life of the process; while a
 * configured backend is unreachable its operations reject, and the accessor
 * retries resolution on its normal failure-backoff schedule.
 */
export function getSharedDependencySnapshotStoreHandle():
  | DependencySnapshotStoreHandle
  | undefined {
  if (sharedHandle) return sharedHandle;
  const accessor = testBackendAccessor ??
    (isSharedBackendConfigured()
      ? (sharedAccessor ??= createDistributedCacheAccessor(
        _createSharedDependencySnapshotCacheBackend,
        "DEPENDENCY-SNAPSHOTS",
      ))
      : undefined);
  if (!accessor) return undefined;
  sharedHandle = createDependencySnapshotStoreHandle(
    createCacheBackedDependencySnapshotStore(accessor),
  );
  return sharedHandle;
}

/** @internal Replace or clear the shared store backend for tests. */
export function _setSharedDependencySnapshotStoreBackendForTest(
  backend: CacheBackend | undefined,
): void {
  testBackendAccessor = backend === undefined ? undefined : () => Promise.resolve(backend);
  sharedHandle = undefined;
  sharedAccessor = undefined;
}
