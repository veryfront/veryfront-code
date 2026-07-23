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

function getInternalStateSizes(cache: MultiTierCache<string>): {
  computations: number;
  keyStates: number;
  mutationQueues: number;
} {
  const internal = cache as unknown as {
    computations: Map<string, unknown>;
    keyStates: Map<string, unknown>;
    mutationQueues: Map<string, unknown>;
  };
  return {
    computations: internal.computations.size,
    keyStates: internal.keyStates.size,
    mutationQueues: internal.mutationQueues.size,
  };
}

describe("MultiTierCache", () => {
  describe("configuration", () => {
    it("rejects unsafe names and invalid default TTLs", () => {
      assertThrows(() => new MultiTierCache({ name: "" }), TypeError);
      assertThrows(() => new MultiTierCache({ name: " cache" }), TypeError);
      assertThrows(
        () => new MultiTierCache({ name: "test", defaultTtlSeconds: 0 }),
        RangeError,
      );
      assertThrows(
        () => new MultiTierCache({ name: "test", defaultTtlSeconds: Number.NaN }),
        RangeError,
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

    it("does not let a slow stale backfill resurrect a deleted key", async () => {
      const l1 = createMockTier("l1");
      const l3 = createMockTier("l3");
      l3.store.set("key", "stale");
      let markBackfillStarted!: () => void;
      const backfillStarted = new Promise<void>((resolve) => {
        markBackfillStarted = resolve;
      });
      let releaseBackfill!: () => void;
      const backfillReleased = new Promise<void>((resolve) => {
        releaseBackfill = resolve;
      });
      l1.set = async (key, value) => {
        if (value === "stale") {
          markBackfillStarted();
          await backfillReleased;
        }
        l1.store.set(key, value);
      };
      const cache = new MultiTierCache({ name: "test", l1, l3, asyncBackfill: true });

      const read = cache.get("key");
      await backfillStarted;
      const deletion = cache.delete("key");
      releaseBackfill();

      assertEquals(await read, "stale");
      await deletion;
      assertEquals(l1.store.has("key"), false);
      assertEquals(l3.store.has("key"), false);
    });

    it("orders a newer set after an already-started stale backfill", async () => {
      const l1 = createMockTier("l1");
      const l3 = createMockTier("l3");
      l3.store.set("key", "stale");
      let markBackfillStarted!: () => void;
      const backfillStarted = new Promise<void>((resolve) => {
        markBackfillStarted = resolve;
      });
      let releaseBackfill!: () => void;
      const backfillReleased = new Promise<void>((resolve) => {
        releaseBackfill = resolve;
      });
      l1.set = async (key, value) => {
        if (value === "stale") {
          markBackfillStarted();
          await backfillReleased;
        }
        l1.store.set(key, value);
      };
      const cache = new MultiTierCache({ name: "test", l1, l3, asyncBackfill: true });

      const read = cache.get("key");
      await backfillStarted;
      const update = cache.set("key", "fresh");
      releaseBackfill();

      assertEquals(await read, "stale");
      await update;
      assertEquals(l1.store.get("key"), "fresh");
      assertEquals(l3.store.get("key"), "fresh");
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
      l3.set = () => Promise.reject(new Error("L3 down"));
      const cache = new MultiTierCache({ name: "test", l1, l3, asyncBackfill: false });

      await assertRejects(() => cache.set("key", "value"), Error, "L3 down");
      assertEquals(l1.store.has("key"), false);
      assertEquals(await cache.get("key"), null);
    });

    it("commits the authoritative tier before local tiers", async () => {
      const order: string[] = [];
      const l1 = createMockTier("l1");
      const l3 = createMockTier("l3");
      l1.set = (key, value) => {
        order.push("l1");
        l1.store.set(key, value);
        return Promise.resolve();
      };
      l3.set = (key, value) => {
        order.push("l3");
        l3.store.set(key, value);
        return Promise.resolve();
      };
      const cache = new MultiTierCache({ name: "test", l1, l3, asyncBackfill: false });

      await cache.set("key", "value");
      assertEquals(order, ["l3", "l1"]);
    });

    it("propagates local write failure when no authoritative tier exists", async () => {
      const l1 = createMockTier("l1");
      l1.set = () => Promise.reject(new Error("L1 down"));
      const cache = new MultiTierCache({ name: "test", l1, asyncBackfill: true });

      await assertRejects(() => cache.set("key", "value"), Error, "L1 down");
    });

    it("validates an explicit TTL before mutating any tier", async () => {
      const l1 = createMockTier("l1");
      const cache = new MultiTierCache({ name: "test", l1 });

      await assertRejects(() => cache.set("key", "value", Number.NaN), RangeError);
      assertEquals(l1.store.has("key"), false);
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

    it("rejects unsupported deletion before mutating any tier", async () => {
      const l1 = createMockTier("l1");
      l1.store.set("key", "value");
      const l3: CacheTier<string> = {
        name: "l3",
        get: () => Promise.resolve(null),
        set: () => Promise.resolve(),
      };
      const cache = new MultiTierCache({ name: "test", l1, l3 });

      await assertRejects(
        () => cache.delete("key"),
        VeryfrontError,
        "Delete is unsupported in cache tier(s): l3",
      );
      assertEquals(l1.store.get("key"), "value");
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

    it("singleflights concurrent computation for the same key", async () => {
      const l1 = createMockTier("l1");
      const cache = new MultiTierCache({ name: "test", l1, asyncBackfill: false });
      let computes = 0;
      let release!: (value: string) => void;
      const pending = new Promise<string>((resolve) => {
        release = resolve;
      });
      const compute = () => {
        computes++;
        return pending;
      };

      const first = cache.getOrCompute("key", compute);
      const second = cache.getOrCompute("key", compute);
      await Promise.resolve();
      release("computed");

      assertEquals(await Promise.all([first, second]), ["computed", "computed"]);
      assertEquals(computes, 1);
    });

    it("does not publish a computation invalidated by delete", async () => {
      const l1 = createMockTier("l1");
      const cache = new MultiTierCache({ name: "test", l1, asyncBackfill: false });
      let markComputeStarted!: () => void;
      const computeStarted = new Promise<void>((resolve) => {
        markComputeStarted = resolve;
      });
      let releaseCompute!: () => void;
      const computeReleased = new Promise<void>((resolve) => {
        releaseCompute = resolve;
      });

      const computed = cache.getOrCompute("key", async () => {
        markComputeStarted();
        await computeReleased;
        return "stale-computation";
      });
      await computeStarted;
      await cache.delete("key");
      releaseCompute();

      assertEquals(await computed, "stale-computation");
      assertEquals(l1.store.has("key"), false);
    });

    it("does not let a computation overwrite a newer explicit set", async () => {
      const l1 = createMockTier("l1");
      const cache = new MultiTierCache({ name: "test", l1, asyncBackfill: false });
      let releaseCompute!: () => void;
      const computeReleased = new Promise<void>((resolve) => {
        releaseCompute = resolve;
      });
      let markComputeStarted!: () => void;
      const computeStarted = new Promise<void>((resolve) => {
        markComputeStarted = resolve;
      });

      const computed = cache.getOrCompute("key", async () => {
        markComputeStarted();
        await computeReleased;
        return "stale-computation";
      });
      await computeStarted;
      await cache.set("key", "fresh");
      releaseCompute();

      assertEquals(await computed, "stale-computation");
      assertEquals(l1.store.get("key"), "fresh");
    });

    it("does not join a computation from an invalidated generation", async () => {
      const l1 = createMockTier("l1");
      const cache = new MultiTierCache({ name: "test", l1, asyncBackfill: false });
      let releaseStale!: () => void;
      const staleReleased = new Promise<void>((resolve) => {
        releaseStale = resolve;
      });
      let markStaleStarted!: () => void;
      const staleStarted = new Promise<void>((resolve) => {
        markStaleStarted = resolve;
      });

      const stale = cache.getOrCompute("key", async () => {
        markStaleStarted();
        await staleReleased;
        return "stale";
      });
      await staleStarted;
      await cache.delete("key");

      const fresh = cache.getOrCompute("key", () => Promise.resolve("fresh"));
      releaseStale();

      assertEquals(await stale, "stale");
      assertEquals(await fresh, "fresh");
      assertEquals(l1.store.get("key"), "fresh");
    });

    it("bounds singleflight state when many distinct computations are pending", async () => {
      const l1 = createMockTier("l1");
      const cache = new MultiTierCache({ name: "test", l1, asyncBackfill: false });
      let release!: (value: string) => void;
      const pending = new Promise<string>((resolve) => {
        release = resolve;
      });
      let started = 0;
      let markAllStarted!: () => void;
      const allStarted = new Promise<void>((resolve) => {
        markAllStarted = resolve;
      });

      const requests = Array.from(
        { length: 1_005 },
        (_, index) =>
          cache.getOrCompute(`key-${index}`, () => {
            started++;
            if (started === 1_005) markAllStarted();
            return pending;
          }),
      );
      await allStarted;

      assertEquals(getInternalStateSizes(cache).computations, 1_000);
      release("computed");
      assertEquals((await Promise.all(requests)).length, 1_005);
      assertEquals(getInternalStateSizes(cache), {
        computations: 0,
        keyStates: 0,
        mutationQueues: 0,
      });
    });
  });

  describe("internal lifecycle", () => {
    it("releases per-key coordination state after operations settle", async () => {
      const l1 = createMockTier("l1");
      const cache = new MultiTierCache({ name: "test", l1, asyncBackfill: false });

      for (let index = 0; index < 100; index++) {
        await cache.set(`key-${index}`, `value-${index}`);
      }
      assertEquals(getInternalStateSizes(cache), {
        computations: 0,
        keyStates: 0,
        mutationQueues: 0,
      });

      await cache.getBatch([...l1.store.keys()]);
      assertEquals(getInternalStateSizes(cache), {
        computations: 0,
        keyStates: 0,
        mutationQueues: 0,
      });
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

      const stats = cache.getStats();
      assertEquals(stats.gets, 3);
      assertEquals(stats.l1Hits, 1);
      assertEquals(stats.l3Hits, 1);
      assertEquals(stats.misses, 1);
      assertEquals(stats.hitRate, 2 / 3);
    });

    it("deduplicates keys before invoking a tier batch operation", async () => {
      const received: string[][] = [];
      const l1: CacheTier<string> = {
        name: "l1",
        get: () => Promise.resolve(null),
        set: () => Promise.resolve(),
        getBatch: (keys) => {
          received.push([...keys]);
          return Promise.resolve(new Map([
            ["a", "value-a"],
            ["b", "value-b"],
          ]));
        },
      };
      const cache = new MultiTierCache({ name: "test", l1, asyncBackfill: false });

      assertEquals(
        await cache.getBatch(["a", "a", "b"]),
        new Map([["a", "value-a"], ["b", "value-b"]]),
      );
      assertEquals(received, [["a", "b"]]);
    });

    it("rejects batches beyond the shared cache-operation limit", async () => {
      const cache = new MultiTierCache({
        name: "test",
        l1: createMockTier("l1"),
        asyncBackfill: false,
      });

      await assertRejects(
        () => cache.getBatch(Array.from({ length: 101 }, (_, index) => `key-${index}`)),
        RangeError,
        "at most 100",
      );
    });

    it("should ignore keys a tier did not receive", async () => {
      const l1: CacheTier<string> = {
        name: "l1",
        get: () => Promise.resolve(null),
        set: () => Promise.resolve(),
        getBatch: () => Promise.resolve(new Map([["unrequested", "poisoned"]])),
      };
      const cache = new MultiTierCache({ name: "test", l1, asyncBackfill: false });

      const result = await cache.getBatch(["requested"]);

      assertEquals(result, new Map([["requested", null]]));
      assertEquals(cache.getStats().l1Hits, 0);
      assertEquals(cache.getStats().misses, 1);
    });
  });
});
