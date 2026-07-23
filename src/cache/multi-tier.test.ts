import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import { type CacheTier, MultiTierCache } from "./multi-tier.ts";

function createMockTier(
  name: string,
): CacheTier<string> & { store: Map<string, string> } {
  const store = new Map<string, string>();

  return {
    name,
    store,
    get(key: string) {
      return Promise.resolve(store.get(key) ?? null);
    },
    set(key: string, value: string) {
      store.set(key, value);
      return Promise.resolve();
    },
    delete(key: string) {
      store.delete(key);
      return Promise.resolve();
    },
  };
}

describe("MultiTierCache", () => {
  describe("constructor", () => {
    it("validates names, TTLs, booleans, and tier contracts", () => {
      assertThrows(() => new MultiTierCache({ name: "" }));
      assertThrows(() => new MultiTierCache({ name: "test", defaultTtlSeconds: -1 }));
      assertThrows(() =>
        new MultiTierCache(
          { name: "test", asyncBackfill: "yes" } as unknown as ConstructorParameters<
            typeof MultiTierCache
          >[0],
        )
      );
      assertThrows(() =>
        new MultiTierCache(
          { name: "test", l1: { name: "broken" } } as unknown as ConstructorParameters<
            typeof MultiTierCache
          >[0],
        )
      );
    });
  });

  describe("get", () => {
    it("should return null on miss", async () => {
      const cache = new MultiTierCache({ name: "test", asyncBackfill: false });
      assertEquals(await cache.get("key"), null);
    });

    it("should hit L1 first", async () => {
      const l1 = createMockTier("l1");
      l1.store.set("key", "l1-value");
      const cache = new MultiTierCache({ name: "test", l1, asyncBackfill: false });

      assertEquals(await cache.get("key"), "l1-value");
      assertEquals(cache.getStats().l1Hits, 1);
    });

    it("should fallthrough to L2 on L1 miss", async () => {
      const l1 = createMockTier("l1");
      const l2 = createMockTier("l2");
      l2.store.set("key", "l2-value");
      const cache = new MultiTierCache({ name: "test", l1, l2, asyncBackfill: false });

      assertEquals(await cache.get("key"), "l2-value");
      assertEquals(cache.getStats().l2Hits, 1);
    });

    it("should fallthrough to L3 on L1+L2 miss", async () => {
      const l1 = createMockTier("l1");
      const l2 = createMockTier("l2");
      const l3 = createMockTier("l3");
      l3.store.set("key", "l3-value");
      const cache = new MultiTierCache({ name: "test", l1, l2, l3, asyncBackfill: false });

      assertEquals(await cache.get("key"), "l3-value");
      assertEquals(cache.getStats().l3Hits, 1);
    });

    it("should backfill L1 on L2 hit", async () => {
      const l1 = createMockTier("l1");
      const l2 = createMockTier("l2");
      l2.store.set("key", "value");
      const cache = new MultiTierCache({
        name: "test",
        l1,
        l2,
        asyncBackfill: false,
        backfillOnHit: true,
      });

      await cache.get("key");
      assertEquals(l1.store.get("key"), "value");
    });

    it("should backfill L1 and L2 on L3 hit", async () => {
      const l1 = createMockTier("l1");
      const l2 = createMockTier("l2");
      const l3 = createMockTier("l3");
      l3.store.set("key", "value");
      const cache = new MultiTierCache({
        name: "test",
        l1,
        l2,
        l3,
        asyncBackfill: false,
        backfillOnHit: true,
      });

      await cache.get("key");
      assertEquals(l1.store.get("key"), "value");
      assertEquals(l2.store.get("key"), "value");
    });

    it("should not backfill when backfillOnHit is false", async () => {
      const l1 = createMockTier("l1");
      const l3 = createMockTier("l3");
      l3.store.set("key", "value");
      const cache = new MultiTierCache({
        name: "test",
        l1,
        l3,
        asyncBackfill: false,
        backfillOnHit: false,
      });

      await cache.get("key");
      assertEquals(l1.store.has("key"), false);
    });

    it("bounds backfills when a target tier stalls", async () => {
      const l1 = createMockTier("l1");
      const l2 = createMockTier("l2");
      const releases: Array<() => void> = [];
      l1.set = () =>
        new Promise<void>((resolve) => {
          releases.push(resolve);
        });
      const keys = Array.from({ length: 1001 }, (_, index) => `key-${index}`);
      for (const key of keys) l2.store.set(key, "value");
      const cache = new MultiTierCache({ name: "test", l1, l2, asyncBackfill: true });

      await Promise.all(keys.map((key) => cache.get(key)));
      const startedBackfills = releases.length;
      for (const release of releases) release();
      await new Promise((resolve) => setTimeout(resolve, 0));

      assertEquals(startedBackfills, 1000);
      assertEquals(cache.getStats().backfills, 1000);
      assertEquals(cache.getStats().droppedBackfills, 1);
    });

    it("does not let a stalled older backfill overwrite a newer write", async () => {
      const l1 = createMockTier("l1");
      const l3 = createMockTier("l3");
      l3.store.set("key", "stale");
      let releaseStale!: () => void;
      const staleRelease = new Promise<void>((resolve) => {
        releaseStale = resolve;
      });
      let markStaleStarted!: () => void;
      const staleStarted = new Promise<void>((resolve) => {
        markStaleStarted = resolve;
      });
      let markFreshWritten!: () => void;
      const freshWritten = new Promise<void>((resolve) => {
        markFreshWritten = resolve;
      });
      l1.set = async (key, value) => {
        if (value === "stale") {
          markStaleStarted();
          await staleRelease;
        }
        l1.store.set(key, value);
        if (value === "fresh") markFreshWritten();
      };
      const cache = new MultiTierCache({ name: "test", l1, l3, asyncBackfill: true });

      assertEquals(await cache.get("key"), "stale");
      await staleStarted;
      const newerWrite = cache.set("key", "fresh");
      await Promise.race([
        freshWritten,
        new Promise<void>((resolve) => setTimeout(resolve, 10)),
      ]);
      releaseStale();
      await newerWrite;
      await new Promise((resolve) => setTimeout(resolve, 0));

      assertEquals(l1.store.get("key"), "fresh");
      assertEquals(l3.store.get("key"), "fresh");
    });

    it("does not suppress a backfill when an unrelated key changes", async () => {
      const l1 = createMockTier("l1");
      const l2 = createMockTier("l2");
      l2.store.set("target", "value");
      let releaseRead!: () => void;
      const readRelease = new Promise<void>((resolve) => {
        releaseRead = resolve;
      });
      let markReadStarted!: () => void;
      const readStarted = new Promise<void>((resolve) => {
        markReadStarted = resolve;
      });
      l2.get = async (key) => {
        if (key === "target") {
          markReadStarted();
          await readRelease;
        }
        return l2.store.get(key) ?? null;
      };
      const cache = new MultiTierCache({ name: "test", l1, l2, asyncBackfill: false });

      const targetRead = cache.get("target");
      await readStarted;
      await cache.set("unrelated", "new-value");
      releaseRead();

      assertEquals(await targetRead, "value");
      assertEquals(l1.store.get("target"), "value");
    });
  });

  describe("set", () => {
    it("should set in all configured tiers", async () => {
      const l1 = createMockTier("l1");
      const l3 = createMockTier("l3");
      const cache = new MultiTierCache({ name: "test", l1, l3, asyncBackfill: false });

      await cache.set("key", "value");
      assertEquals(l1.store.get("key"), "value");
      assertEquals(l3.store.get("key"), "value");
    });

    it("should increment set stats", async () => {
      const cache = new MultiTierCache({
        name: "test",
        l1: createMockTier("l1"),
        asyncBackfill: false,
      });

      await cache.set("a", "1");
      await cache.set("b", "2");

      assertEquals(cache.getStats().sets, 2);
    });

    it("does not publish locally when the authoritative tier rejects", async () => {
      const l1 = createMockTier("l1");
      const l3 = createMockTier("l3");
      l3.set = () => Promise.reject(new Error("distributed write failed"));
      const cache = new MultiTierCache({ name: "test", l1, l3, asyncBackfill: false });

      await assertRejects(() => cache.set("key", "value"));

      assertEquals(l1.store.has("key"), false);
    });

    it("applies same-key writes in invocation order", async () => {
      const l3 = createMockTier("l3");
      const started: string[] = [];
      const releases: Array<() => void> = [];
      l3.set = (key, value) =>
        new Promise<void>((resolve) => {
          started.push(value);
          releases.push(() => {
            l3.store.set(key, value);
            resolve();
          });
        });
      const cache = new MultiTierCache({ name: "test", l3, asyncBackfill: false });

      const first = cache.set("key", "first");
      await new Promise((resolve) => setTimeout(resolve, 0));
      const second = cache.set("key", "second");
      await new Promise((resolve) => setTimeout(resolve, 0));

      assertEquals(started, ["first"]);
      releases.shift()?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
      assertEquals(started, ["first", "second"]);
      releases.shift()?.();
      await Promise.all([first, second]);
      assertEquals(l3.store.get("key"), "second");
    });

    it("bounds queued mutations for one blocked key", async () => {
      const l3 = createMockTier("l3");
      let releaseFirst!: () => void;
      const firstRelease = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      let calls = 0;
      l3.set = async (key, value) => {
        calls++;
        if (calls === 1) await firstRelease;
        l3.store.set(key, value);
      };
      const cache = new MultiTierCache({ name: "test", l3, asyncBackfill: false });
      const accepted = Array.from(
        { length: 1000 },
        (_, index) => cache.set("key", `value-${index}`),
      );

      let overflowError: unknown;
      let unexpectedMutation: Promise<void> | undefined;
      try {
        unexpectedMutation = cache.set("key", "overflow");
      } catch (error) {
        overflowError = error;
      } finally {
        releaseFirst();
      }

      await Promise.all(unexpectedMutation ? [...accepted, unexpectedMutation] : accepted);
      assertEquals(overflowError instanceof VeryfrontError, true);
    });
  });

  describe("delete", () => {
    it("should delete from all tiers", async () => {
      const l1 = createMockTier("l1");
      const l3 = createMockTier("l3");
      l1.store.set("key", "v");
      l3.store.set("key", "v");
      const cache = new MultiTierCache({ name: "test", l1, l3, asyncBackfill: false });

      await cache.delete("key");
      assertEquals(l1.store.has("key"), false);
      assertEquals(l3.store.has("key"), false);
    });

    it("should report tiers that failed to delete the key", async () => {
      const l1 = createMockTier("l1");
      const l3 = createMockTier("l3");
      l3.delete = () => Promise.reject(new Error("backend unavailable"));
      const cache = new MultiTierCache({ name: "test", l1, l3, asyncBackfill: false });

      await assertRejects(
        () => cache.delete("key"),
        VeryfrontError,
        "Delete failed in cache tier(s): l3",
      );
    });

    it("does not evict local tiers when the authoritative delete fails", async () => {
      const l1 = createMockTier("l1");
      const l3 = createMockTier("l3");
      l1.store.set("key", "value");
      l3.store.set("key", "value");
      l3.delete = () => Promise.reject(new Error("backend unavailable"));
      const cache = new MultiTierCache({ name: "test", l1, l3, asyncBackfill: false });

      await assertRejects(() => cache.delete("key"));

      assertEquals(l1.store.get("key"), "value");
      assertEquals(l3.store.get("key"), "value");
    });

    it("does not report success when a configured tier cannot delete", async () => {
      const store = new Map<string, string>([["key", "value"]]);
      const l1: CacheTier<string> = {
        name: "l1",
        get: (key) => Promise.resolve(store.get(key) ?? null),
        set: (key, value) => {
          store.set(key, value);
          return Promise.resolve();
        },
      };
      const cache = new MultiTierCache({ name: "test", l1, asyncBackfill: false });

      await assertRejects(
        () => cache.delete("key"),
        VeryfrontError,
        "Delete failed in cache tier(s): l1",
      );
      assertEquals(store.get("key"), "value");
    });
  });

  describe("getOrCompute", () => {
    it("should return cached value without computing", async () => {
      const l1 = createMockTier("l1");
      l1.store.set("key", "cached");
      const cache = new MultiTierCache({ name: "test", l1, asyncBackfill: false });

      let computed = false;
      const result = await cache.getOrCompute("key", () => {
        computed = true;
        return Promise.resolve("fresh");
      });

      assertEquals(result, "cached");
      assertEquals(computed, false);
    });

    it("should compute and store on miss", async () => {
      const l1 = createMockTier("l1");
      const cache = new MultiTierCache({ name: "test", l1, asyncBackfill: false });

      const result = await cache.getOrCompute("key", () => Promise.resolve("computed-value"));
      assertEquals(result, "computed-value");
      assertEquals(l1.store.get("key"), "computed-value");
    });

    it("coalesces concurrent computations for the same key", async () => {
      const l1 = createMockTier("l1");
      const cache = new MultiTierCache({ name: "test", l1, asyncBackfill: false });
      let computeCalls = 0;
      const compute = async () => {
        computeCalls++;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return "computed-value";
      };

      const values = await Promise.all([
        cache.getOrCompute("key", compute),
        cache.getOrCompute("key", compute),
      ]);

      assertEquals(values, ["computed-value", "computed-value"]);
      assertEquals(computeCalls, 1);
    });

    it("does not let an older computation overwrite a newer explicit write", async () => {
      const l1 = createMockTier("l1");
      const cache = new MultiTierCache({ name: "test", l1, asyncBackfill: false });
      let finishCompute!: (value: string) => void;
      let markStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      const computation = cache.getOrCompute("key", () => {
        markStarted();
        return new Promise<string>((resolve) => {
          finishCompute = resolve;
        });
      });

      await started;
      await cache.set("key", "explicit");
      finishCompute("computed");

      assertEquals(await computation, "computed");
      assertEquals(l1.store.get("key"), "explicit");
    });

    it("does not join a computation invalidated by a later delete", async () => {
      const l1 = createMockTier("l1");
      const cache = new MultiTierCache({ name: "test", l1, asyncBackfill: false });
      let finishOld!: (value: string) => void;
      let markOldStarted!: () => void;
      const oldStarted = new Promise<void>((resolve) => {
        markOldStarted = resolve;
      });
      const oldComputation = cache.getOrCompute("key", () => {
        markOldStarted();
        return new Promise<string>((resolve) => {
          finishOld = resolve;
        });
      });

      await oldStarted;
      await cache.delete("key");
      let newComputeCalls = 0;
      const newComputation = cache.getOrCompute("key", () => {
        newComputeCalls++;
        return Promise.resolve("new");
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      assertEquals(newComputeCalls, 1);
      assertEquals(await newComputation, "new");
      finishOld("old");
      assertEquals(await oldComputation, "old");
      assertEquals(l1.store.get("key"), "new");
    });

    it("stores a computation when only an unrelated key changes", async () => {
      const l1 = createMockTier("l1");
      const cache = new MultiTierCache({ name: "test", l1, asyncBackfill: false });
      let finishCompute!: (value: string) => void;
      let markStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      const computation = cache.getOrCompute("target", () => {
        markStarted();
        return new Promise<string>((resolve) => {
          finishCompute = resolve;
        });
      });

      await started;
      await cache.set("unrelated", "new-value");
      finishCompute("computed");

      assertEquals(await computation, "computed");
      assertEquals(l1.store.get("target"), "computed");
    });
  });

  describe("getStats", () => {
    it("should track hit rate", async () => {
      const l1 = createMockTier("l1");
      l1.store.set("a", "1");
      const cache = new MultiTierCache({ name: "test", l1, asyncBackfill: false });

      await cache.get("a"); // hit
      await cache.get("b"); // miss

      const stats = cache.getStats();
      assertEquals(stats.gets, 2);
      assertEquals(stats.l1Hits, 1);
      assertEquals(stats.misses, 1);
      assertEquals(stats.hitRate, 0.5);
    });

    it("should reset stats", async () => {
      const l1 = createMockTier("l1");
      l1.store.set("a", "1");
      const cache = new MultiTierCache({ name: "test", l1, asyncBackfill: false });

      await cache.get("a");
      cache.resetStats();

      const stats = cache.getStats();
      assertEquals(stats.gets, 0);
      assertEquals(stats.l1Hits, 0);
    });
  });

  describe("getBatch", () => {
    it("should return empty map for empty keys", async () => {
      const cache = new MultiTierCache({ name: "test", asyncBackfill: false });
      const result = await cache.getBatch([]);
      assertEquals(result.size, 0);
    });

    it("should batch get from multiple tiers", async () => {
      const l1 = createMockTier("l1");
      const l3 = createMockTier("l3");
      l1.store.set("a", "l1-a");
      l3.store.set("b", "l3-b");
      const cache = new MultiTierCache({
        name: "test",
        l1,
        l3,
        asyncBackfill: false,
        backfillOnHit: true,
      });

      const result = await cache.getBatch(["a", "b", "c"]);
      assertEquals(result.get("a"), "l1-a");
      assertEquals(result.get("b"), "l3-b");
      assertEquals(result.get("c"), null);
      assertEquals(cache.getStats().gets, 3);
      assertEquals(cache.getStats().hitRate, 2 / 3);
    });

    it("bounds fallback tier read concurrency", async () => {
      const l1 = createMockTier("l1");
      let activeReads = 0;
      let maxActiveReads = 0;
      l1.get = async () => {
        activeReads++;
        maxActiveReads = Math.max(maxActiveReads, activeReads);
        await Promise.resolve();
        activeReads--;
        return null;
      };
      const cache = new MultiTierCache({ name: "test", l1, asyncBackfill: false });

      await cache.getBatch(["a", "b", "c"]);

      assertEquals(maxActiveReads, 1);
    });

    it("ignores unrequested keys returned by a tier", async () => {
      const l1 = createMockTier("l1");
      const l3 = createMockTier("l3");
      l3.getBatch = () =>
        Promise.resolve(
          new Map([
            ["requested", "value"],
            ["foreign", "poison"],
          ]),
        );
      const cache = new MultiTierCache({ name: "test", l1, l3, asyncBackfill: false });

      const result = await cache.getBatch(["requested"]);

      assertEquals(result, new Map([["requested", "value"]]));
      assertEquals(l1.store.has("foreign"), false);
    });
  });
});
