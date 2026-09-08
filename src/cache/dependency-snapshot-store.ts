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
 * so disk and memory backends never serve as snapshot history.
 *
 * Failure semantics follow the store contract: publication resolves only after
 * the backend demonstrably retains the exact bytes (the backends fail open on
 * `set`, so publication re-reads and verifies), and different bytes at an
 * already-published key fail rather than overwrite. Reads of malformed records
 * reject; a fail-open backend read that reports an outage as a miss degrades to
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

const SNAPSHOT_KEY_PREFIX = "dependency-snapshots";

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
  return { value, expiresAt: expiresAt as number };
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

  return {
    publish: async (namespace, key, value, expiresAt) => {
      const backend = await requireBackend();
      const cacheKey = recordKey(namespace, key);

      const existingRaw = await backend.get(cacheKey);
      if (existingRaw !== null) {
        const existing = decodeRecord(existingRaw);
        if (existing.value !== value) {
          throw new Error("Dependency snapshot key already holds different bytes");
        }
        if (existing.expiresAt >= expiresAt) return;
      }

      const ttlSeconds = Math.ceil((expiresAt - Date.now()) / 1000);
      if (ttlSeconds <= 0) {
        throw new Error("Dependency snapshot retention window has already passed");
      }
      await backend.set(cacheKey, JSON.stringify({ value, expiresAt }), ttlSeconds);

      // The backends fail open on `set`, and acknowledged retention is the
      // whole point of publication: a document only advertises a pin its
      // replicas can later resolve. Verify the write actually landed.
      const writtenRaw = await backend.get(cacheKey);
      const written = writtenRaw === null ? null : decodeRecord(writtenRaw);
      if (written?.value !== value) {
        throw new Error("Dependency snapshot publication was not retained");
      }
    },

    read: async (namespace, key) => {
      const backend = await requireBackend();
      const raw = await backend.get(recordKey(namespace, key));
      if (raw === null) return null;
      return decodeRecord(raw);
    },
  };
}

/** Only backends shared across replicas satisfy the snapshot store contract. */
function isSharedBackendConfigured(): boolean {
  return isApiCacheAvailable() || isRedisConfigured();
}

let testBackendAccessor: (() => Promise<CacheBackend | null>) | undefined;
let sharedHandle: DependencySnapshotStoreHandle | undefined;
let sharedAccessor: (() => Promise<CacheBackend | null>) | undefined;

function sharedBackendAccessor(): () => Promise<CacheBackend | null> {
  sharedAccessor ??= (() => {
    const accessor = createDistributedCacheAccessor(
      () => createCacheBackend({ keyPrefix: SNAPSHOT_KEY_PREFIX }),
      "DEPENDENCY-SNAPSHOTS",
    );
    return async () => {
      const backend = await accessor();
      // A configured-but-degraded resolution can fall back to disk or memory,
      // which is node-local and must not masquerade as shared history.
      return backend && (backend.type === "api" || backend.type === "redis") ? backend : null;
    };
  })();
  return sharedAccessor;
}

/**
 * The process-wide shared snapshot store handle, or `undefined` when no shared
 * cache backend is configured (local development keeps process-local history).
 * The handle is created lazily and reused for the life of the process.
 */
export function getSharedDependencySnapshotStoreHandle(): DependencySnapshotStoreHandle | undefined {
  if (sharedHandle) return sharedHandle;
  const accessor = testBackendAccessor ??
    (isSharedBackendConfigured() ? sharedBackendAccessor() : undefined);
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
