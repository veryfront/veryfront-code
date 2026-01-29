import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { EvictionManager, type LRUTrackerInterface } from "./eviction-manager.ts";

function createMockTracker(keys: string[]): LRUTrackerInterface {
  const queue = [...keys];
  const removed = new Set<string>();
  return {
    getLRU() {
      while (queue.length > 0) {
        const key = queue.shift()!;
        if (!removed.has(key)) return key;
      }
      return undefined;
    },
    remove(key: string) {
      removed.add(key);
    },
  };
}

describe("EvictionManager", () => {
  describe("isExpired", () => {
    it("should return true when entry expiry is in the past", () => {
      const em = new EvictionManager();
      assertEquals(em.isExpired({ size: 1, expiry: 1000 }, undefined, 2000), true);
    });

    it("should return false when entry expiry is in the future", () => {
      const em = new EvictionManager();
      assertEquals(em.isExpired({ size: 1, expiry: 3000 }, undefined, 2000), false);
    });

    it("should use timestamp + ttl when no expiry", () => {
      const em = new EvictionManager();
      assertEquals(em.isExpired({ size: 1, timestamp: 1000 }, 500, 2000), true);
      assertEquals(em.isExpired({ size: 1, timestamp: 1000 }, 5000, 2000), false);
    });

    it("should return false when no expiry info available", () => {
      const em = new EvictionManager();
      assertEquals(em.isExpired({ size: 1 }), false);
    });
  });

  describe("evictLRU", () => {
    it("should evict least recently used entry", () => {
      const em = new EvictionManager();
      const cache = new Map([
        ["a", { size: 10, value: "va" }],
        ["b", { size: 20, value: "vb" }],
      ]);
      const tracker = createMockTracker(["a", "b"]);

      const evictedSize = em.evictLRU(cache, tracker);
      assertEquals(evictedSize, 10);
      assertEquals(cache.has("a"), false);
      assertEquals(cache.has("b"), true);
    });

    it("should return 0 when nothing to evict", () => {
      const em = new EvictionManager();
      const cache = new Map<string, { size: number }>();
      const tracker = createMockTracker([]);

      assertEquals(em.evictLRU(cache, tracker), 0);
    });

    it("should call onEvict callback", () => {
      let evictedKey = "";
      const em = new EvictionManager({
        onEvict: (key) => { evictedKey = key; },
      });
      const cache = new Map([["a", { size: 5, value: "val" }]]);
      const tracker = createMockTracker(["a"]);

      em.evictLRU(cache, tracker);
      assertEquals(evictedKey, "a");
    });
  });

  describe("evictIfNeeded", () => {
    it("should evict to make room by entry count", () => {
      const em = new EvictionManager();
      const cache = new Map([
        ["a", { size: 10, value: "a" }],
        ["b", { size: 10, value: "b" }],
      ]);
      const tracker = createMockTracker(["a", "b"]);

      em.evictIfNeeded(cache, tracker, 10, 2, 1000);
      assertEquals(cache.size < 2, true);
    });

    it("should evict to make room by memory", () => {
      const em = new EvictionManager();
      const cache = new Map([
        ["a", { size: 50, value: "a" }],
        ["b", { size: 50, value: "b" }],
      ]);
      const tracker = createMockTracker(["a", "b"]);

      // Max memory = 80, current = 100, adding 10 → need to free some
      em.evictIfNeeded(cache, tracker, 10, 100, 80);
      // Should have evicted at least one
      assertEquals(cache.size < 2, true);
    });
  });

  describe("evictExpired", () => {
    it("should evict entries past their TTL", () => {
      const em = new EvictionManager();
      const cache = new Map([
        ["fresh", { size: 1, timestamp: Date.now() }],
        ["stale", { size: 1, timestamp: 0 }],
      ]);
      const tracker = createMockTracker(["fresh", "stale"]);

      const evicted = em.evictExpired(cache, tracker, 1000);
      assertEquals(evicted, 1);
      assertEquals(cache.has("stale"), false);
      assertEquals(cache.has("fresh"), true);
    });

    it("should return 0 when nothing expired", () => {
      const em = new EvictionManager();
      const cache = new Map([
        ["a", { size: 1, timestamp: Date.now() }],
      ]);
      const tracker = createMockTracker(["a"]);

      assertEquals(em.evictExpired(cache, tracker, 60000), 0);
    });
  });
});
