import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { type CacheTier, MultiTierCache } from "./multi-tier.ts";

function createMockTier(name: string): CacheTier<string> & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    name,
    store,
    get: (key: string) => Promise.resolve(store.get(key) ?? null),
    set: (key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    },
    delete: (key: string) => {
      store.delete(key);
      return Promise.resolve();
    },
  };
}

describe("MultiTierCache", () => {
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

      assertEquals(cache.getStats().gets, 0);
      assertEquals(cache.getStats().l1Hits, 0);
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
    });
  });
});
