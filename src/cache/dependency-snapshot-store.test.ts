import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { CacheBackend } from "./types.ts";
import { MemoryCacheBackend } from "./backends/memory.ts";
import {
  _setSharedDependencySnapshotStoreBackendForTest,
  createCacheBackedDependencySnapshotStore,
  getSharedDependencySnapshotStoreHandle,
} from "./dependency-snapshot-store.ts";
import { resolveDependencySnapshotStoreHandle } from "#veryfront/platform/adapters/dependency-snapshot-store.ts";

function backedStore(backend: CacheBackend | null) {
  return createCacheBackedDependencySnapshotStore(() => Promise.resolve(backend));
}

const NAMESPACE = "a".repeat(64);
const KEY = "on:54uvgwr2ih7p";

describe("cache/dependency-snapshot-store", () => {
  afterEach(() => {
    _setSharedDependencySnapshotStoreBackendForTest(undefined);
  });

  describe("createCacheBackedDependencySnapshotStore", () => {
    it("round-trips a published snapshot record", async () => {
      const store = backedStore(new MemoryCacheBackend());
      const expiresAt = Date.now() + 60_000;
      await store.publish(NAMESPACE, KEY, "snapshot-bytes", expiresAt);

      assertEquals(await store.read(NAMESPACE, KEY), {
        value: "snapshot-bytes",
        expiresAt,
      });
    });

    it("returns null for history it never stored", async () => {
      const store = backedStore(new MemoryCacheBackend());
      assertEquals(await store.read(NAMESPACE, KEY), null);
    });

    it("keeps namespaces and keys apart", async () => {
      const store = backedStore(new MemoryCacheBackend());
      const expiresAt = Date.now() + 60_000;
      await store.publish(NAMESPACE, KEY, "snapshot-bytes", expiresAt);

      assertEquals(await store.read("b".repeat(64), KEY), null);
      assertEquals(await store.read(NAMESPACE, "on:otherkey"), null);
    });

    it("accepts an identical republication", async () => {
      const store = backedStore(new MemoryCacheBackend());
      const expiresAt = Date.now() + 60_000;
      await store.publish(NAMESPACE, KEY, "snapshot-bytes", expiresAt);
      await store.publish(NAMESPACE, KEY, "snapshot-bytes", expiresAt + 1_000);

      const record = await store.read(NAMESPACE, KEY);
      assertEquals(record?.value, "snapshot-bytes");
    });

    it("rejects different bytes at an already-published key", async () => {
      const store = backedStore(new MemoryCacheBackend());
      const expiresAt = Date.now() + 60_000;
      await store.publish(NAMESPACE, KEY, "snapshot-bytes", expiresAt);

      await assertRejects(() => store.publish(NAMESPACE, KEY, "different-bytes", expiresAt));
      assertEquals((await store.read(NAMESPACE, KEY))?.value, "snapshot-bytes");
    });

    it("rejects a publication whose retention window already passed", async () => {
      const store = backedStore(new MemoryCacheBackend());
      await assertRejects(() => store.publish(NAMESPACE, KEY, "snapshot-bytes", Date.now() - 1));
    });

    it("rejects a publication the backend silently dropped", async () => {
      const backend = new MemoryCacheBackend();
      const droppingBackend = Object.create(backend) as CacheBackend;
      Object.defineProperty(droppingBackend, "set", {
        value: () => Promise.resolve(),
        enumerable: true,
      });
      const store = backedStore(droppingBackend);

      await assertRejects(() =>
        store.publish(NAMESPACE, KEY, "snapshot-bytes", Date.now() + 60_000)
      );
    });

    it("rejects reads of malformed stored records", async () => {
      const backend = new MemoryCacheBackend();
      await backend.set(`${NAMESPACE}:${KEY}`, "not-json", 60);
      const store = backedStore(backend);

      await assertRejects(() => store.read(NAMESPACE, KEY));
    });

    it("rejects operations while the backend is unavailable", async () => {
      const store = backedStore(null);

      await assertRejects(() => store.publish(NAMESPACE, KEY, "snapshot-bytes", Date.now() + 1_000));
      await assertRejects(() => store.read(NAMESPACE, KEY));
    });
  });

  describe("getSharedDependencySnapshotStoreHandle", () => {
    it("returns undefined when no shared cache backend is configured", () => {
      assertEquals(getSharedDependencySnapshotStoreHandle(), undefined);
    });

    it("returns a stable handle backed by the injected backend", async () => {
      _setSharedDependencySnapshotStoreBackendForTest(new MemoryCacheBackend());
      const handle = getSharedDependencySnapshotStoreHandle();
      assertExists(handle);
      assertEquals(getSharedDependencySnapshotStoreHandle(), handle);

      const store = resolveDependencySnapshotStoreHandle(handle);
      const expiresAt = Date.now() + 60_000;
      await store.publish(NAMESPACE, KEY, "snapshot-bytes", expiresAt);
      assertEquals(await store.read(NAMESPACE, KEY), {
        value: "snapshot-bytes",
        expiresAt,
      });
    });
  });
});
