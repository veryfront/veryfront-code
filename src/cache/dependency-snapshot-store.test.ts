import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { CacheBackend, CacheRevisionMutation, CacheRevisionSnapshot } from "./types.ts";
import { buildRevisionedCacheKey } from "./capabilities.ts";
import { MemoryCacheBackend } from "./backends/memory.ts";
import { createCacheBackedDependencySnapshotStore } from "./dependency-snapshot-store.ts";

function backedStore(backend: CacheBackend | null) {
  return createCacheBackedDependencySnapshotStore(() => Promise.resolve(backend));
}

const NAMESPACE = "a".repeat(64);
const KEY = "on:54uvgwr2ih7p";

describe("cache/dependency-snapshot-store", () => {
  describe("createCacheBackedDependencySnapshotStore", () => {
    it("uses the reserved logical key for revisioned publication and subsequent reads", async () => {
      const expected = buildRevisionedCacheKey(`${NAMESPACE}:${KEY}`);
      let retained: string | null = null;
      const backend: CacheBackend = {
        type: "redis",
        get: (key) => {
          assertEquals(key, expected);
          return Promise.resolve(retained);
        },
        set: () => Promise.reject(new Error("Unconditional publication is not allowed")),
        del: () => Promise.resolve(),
        getWithRevision: (key) => {
          assertEquals(key, expected);
          return Promise.resolve({ value: retained, revision: "synthetic-revision" });
        },
        compareExchange: (key, _revision, mutation) => {
          assertEquals(key, expected);
          retained = mutation.kind === "set" ? mutation.value : null;
          return Promise.resolve(true);
        },
      };
      const store = backedStore(backend);
      const expiresAt = Date.now() + 60_000;
      await store.publish(NAMESPACE, KEY, "snapshot-bytes", expiresAt);
      assertEquals(await store.read(NAMESPACE, KEY), { value: "snapshot-bytes", expiresAt });
    });

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

      await assertRejects(() =>
        store.publish(NAMESPACE, KEY, "snapshot-bytes", Date.now() + 1_000)
      );
      await assertRejects(() => store.read(NAMESPACE, KEY));
    });

    it("rejects a renewal whose new deadline the backend silently dropped", async () => {
      const backend = new MemoryCacheBackend();
      const store = backedStore(backend);
      const firstDeadline = Date.now() + 60_000;
      await store.publish(NAMESPACE, KEY, "snapshot-bytes", firstDeadline);

      const droppingBackend = Object.create(backend) as CacheBackend;
      Object.defineProperty(droppingBackend, "set", {
        value: () => Promise.resolve(),
        enumerable: true,
      });
      // Well past the small concurrency slack, as a real renewal would be.
      await assertRejects(() =>
        backedStore(droppingBackend).publish(
          NAMESPACE,
          KEY,
          "snapshot-bytes",
          firstDeadline + 3_600_000,
        )
      );
    });

    it("rejects oversized stored records instead of materializing them", async () => {
      const backend = new MemoryCacheBackend(10, { maxSizeBytes: 8 * 1024 * 1024 });
      await backend.set(
        `${NAMESPACE}:${KEY}`,
        JSON.stringify({ value: "x".repeat(2 * 1024 * 1024), expiresAt: Date.now() + 60_000 }),
        60,
      );
      await assertRejects(() => backedStore(backend).read(NAMESPACE, KEY));
    });

    it("round-trips a near-limit payload dense with JSON escaping", async () => {
      // The record embeds the payload as a JSON string, so quotes and
      // backslashes double in size. A payload at the 1 MiB contract limit must
      // still publish and read back even at worst-case escaping inflation.
      const store = backedStore(new MemoryCacheBackend(10, { maxSizeBytes: 8 * 1024 * 1024 }));
      const value = '"\\'.repeat(524_288); // 1,048,576 bytes, all escaping
      const expiresAt = Date.now() + 60_000;
      await store.publish(NAMESPACE, KEY, value, expiresAt);

      assertEquals(await store.read(NAMESPACE, KEY), { value, expiresAt });
    });

    it("returns null for a stale record a backend retained past its deadline", async () => {
      const backend = new MemoryCacheBackend();
      await backend.set(
        `${NAMESPACE}:${KEY}`,
        JSON.stringify({ value: "snapshot-bytes", expiresAt: Date.now() - 1 }),
        60,
      );

      assertEquals(await backedStore(backend).read(NAMESPACE, KEY), null);
    });

    it("rejects operations whose signal is already aborted", async () => {
      const store = backedStore(new MemoryCacheBackend());
      const aborted = AbortSignal.abort();

      await assertRejects(() =>
        store.publish(NAMESPACE, KEY, "snapshot-bytes", Date.now() + 60_000, aborted)
      );
      await assertRejects(() => store.read(NAMESPACE, KEY, aborted));
    });

    it("rejects a publication whose payload exceeds the snapshot limit", async () => {
      await assertRejects(() =>
        backedStore(new MemoryCacheBackend(10, { maxSizeBytes: 8 * 1024 * 1024 })).publish(
          NAMESPACE,
          KEY,
          "x".repeat(1_048_577),
          Date.now() + 60_000,
        )
      );
    });

    it("acknowledges at most one of two conflicting concurrent publications", async () => {
      // A revisioned backend where both publishers observe the key absent
      // before either writes: the losing compare-exchange must surface as a
      // rejected publication, never as a second acknowledgement.
      const records = new Map<string, { value: string; revision: number }>();
      let arrivals = 0;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const backend: CacheBackend = {
        type: "memory",
        get: (key: string) => Promise.resolve(records.get(key)?.value ?? null),
        set: (key: string, value: string) => {
          const revision = (records.get(key)?.revision ?? 0) + 1;
          records.set(key, { value, revision });
          return Promise.resolve();
        },
        del: (key: string) => {
          records.delete(key);
          return Promise.resolve();
        },
        getWithRevision: async (key: string): Promise<CacheRevisionSnapshot> => {
          if (++arrivals <= 2) {
            if (arrivals === 2) release();
            await gate;
            return { value: null, revision: "0" };
          }
          const record = records.get(key);
          return { value: record?.value ?? null, revision: String(record?.revision ?? 0) };
        },
        compareExchange: (
          key: string,
          expectedRevision: string,
          mutation: CacheRevisionMutation,
        ): Promise<boolean> => {
          const current = records.get(key);
          if (String(current?.revision ?? 0) !== expectedRevision) return Promise.resolve(false);
          if (mutation.kind === "set") {
            records.set(key, { value: mutation.value, revision: (current?.revision ?? 0) + 1 });
          } else records.delete(key);
          return Promise.resolve(true);
        },
      };
      const store = backedStore(backend);
      const expiresAt = Date.now() + 60_000;

      const outcomes = await Promise.allSettled([
        store.publish(NAMESPACE, KEY, "publisher-a", expiresAt),
        store.publish(NAMESPACE, KEY, "publisher-b", expiresAt),
      ]);

      assertEquals(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
      const survivor = outcomes[0]?.status === "fulfilled" ? "publisher-a" : "publisher-b";
      const record = await store.read(NAMESPACE, KEY);
      assertEquals(record?.value, survivor);
    });
  });
});
