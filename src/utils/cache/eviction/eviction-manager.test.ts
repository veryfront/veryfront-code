import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { EvictionManager, type LRUTrackerInterface } from "./eviction-manager.ts";

function createMockTracker(keys: string[]): LRUTrackerInterface {
  const queue = [...keys];
  const removed = new Set<string>();

  return {
    getLRU() {
      while (queue.length) {
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

    it("expires entries exactly at their expiry boundary", () => {
      const em = new EvictionManager();
      assertEquals(em.isExpired({ size: 1, expiry: 2000 }, undefined, 2000), true);
      assertEquals(em.isExpired({ size: 1, timestamp: 1500 }, 500, 2000), true);
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

    it("evicts an empty-string cache key", () => {
      const em = new EvictionManager();
      const cache = new Map([["", { size: 5, value: "value" }]]);
      const tracker = createMockTracker([""]);

      assertEquals(em.evictLRU(cache, tracker), 5);
      assertEquals(cache.size, 0);
    });

    it("should call onEvict callback", () => {
      let evictedKey = "";
      const em = new EvictionManager({
        onEvict: (key) => {
          evictedKey = key;
        },
      });
      const cache = new Map([["a", { size: 5, value: "val" }]]);
      const tracker = createMockTracker(["a"]);

      em.evictLRU(cache, tracker);
      assertEquals(evictedKey, "a");
    });

    it("isolates errors thrown by onEvict callbacks", () => {
      const em = new EvictionManager({
        onEvict: () => {
          throw new Error("observer failed");
        },
      });
      const cache = new Map([["a", { size: 5, value: "value" }]]);

      assertEquals(em.evictLRU(cache, createMockTracker(["a"])), 5);
      assertEquals(cache.size, 0);
    });
  });

  describe("evictIfNeeded", () => {
    it("rejects invalid capacity and size inputs", () => {
      const em = new EvictionManager();
      const cache = new Map<string, { size: number }>();
      const tracker = createMockTracker([]);

      assertThrows(() => em.evictIfNeeded(cache, tracker, -1, 1, 1), RangeError);
      assertThrows(() => em.evictIfNeeded(cache, tracker, 0, 0, 1), RangeError);
      assertThrows(() => em.evictIfNeeded(cache, tracker, 0, 1, -1), RangeError);
      assertThrows(
        () => em.evictIfNeeded(cache, tracker, Number.NaN, 1, 1),
        RangeError,
      );
    });

    it("fails explicitly when the LRU tracker cannot make progress", () => {
      const em = new EvictionManager();
      const cache = new Map([["present", { size: 1 }]]);
      let calls = 0;
      const tracker: LRUTrackerInterface = {
        getLRU() {
          calls++;
          if (calls === 1) return "missing";
          throw new Error("tracker queried twice");
        },
        remove() {},
      };

      assertThrows(
        () => em.evictIfNeeded(cache, tracker, 1, 1, 10),
        Error,
        "Unable to evict",
      );
    });

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

      em.evictIfNeeded(cache, tracker, 10, 100, 80);
      assertEquals(cache.size < 2, true);
    });
  });

  describe("evictExpired", () => {
    it("should evict entries past their TTL", () => {
      const em = new EvictionManager();
      const now = Date.now();
      const cache = new Map([
        ["fresh", { size: 1, timestamp: now }],
        ["stale", { size: 1, timestamp: 0 }],
      ]);
      const tracker = createMockTracker(["fresh", "stale"]);

      const evicted = em.evictExpired(cache, tracker, 1000);
      assertEquals(evicted, 1);
      assertEquals(cache.has("stale"), false);
      assertEquals(cache.has("fresh"), true);
    });

    it("notifies onEvict for expired entries without exposing observer failures", () => {
      const evicted: string[] = [];
      const em = new EvictionManager({
        onEvict: (key) => {
          evicted.push(key);
          throw new Error("observer failed");
        },
      });
      const cache = new Map([["stale", { size: 1, expiry: 0, value: "value" }]]);

      assertEquals(em.evictExpired(cache, createMockTracker(["stale"]), 1000), 1);
      assertEquals(evicted, ["stale"]);
      assertEquals(cache.size, 0);
    });

    it("should return 0 when nothing expired", () => {
      const em = new EvictionManager();
      const cache = new Map([["a", { size: 1, timestamp: Date.now() }]]);
      const tracker = createMockTracker(["a"]);

      assertEquals(em.evictExpired(cache, tracker, 60000), 0);
    });
  });
});
