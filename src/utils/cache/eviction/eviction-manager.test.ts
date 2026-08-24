import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  type EvictableEntry,
  EvictionManager,
  type LRUListManagerInterface,
  type LRUNodeInterface,
  type LRUTrackerInterface,
} from "./eviction-manager.ts";

interface MockTracker {
  tracker: LRUTrackerInterface;
  removeCalls: string[];
}

function createMockTracker(keys: string[]): MockTracker {
  const queue = [...keys];
  const removeCalls: string[] = [];

  return {
    removeCalls,
    tracker: {
      getLRU() {
        return queue[0];
      },
      remove(key: string) {
        removeCalls.push(key);
        const index = queue.indexOf(key);
        if (index !== -1) queue.splice(index, 1);
      },
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

    it("should expire an entry exactly at its expiry timestamp", () => {
      const em = new EvictionManager();
      assertEquals(em.isExpired({ size: 1, expiry: 2000 }, undefined, 2000), true);
    });

    it("should use timestamp + ttl when no expiry", () => {
      const em = new EvictionManager();
      assertEquals(em.isExpired({ size: 1, timestamp: 1000 }, 500, 2000), true);
      assertEquals(em.isExpired({ size: 1, timestamp: 1000 }, 5000, 2000), false);
    });

    it("should expire a timestamp-based entry exactly at its ttl boundary", () => {
      const em = new EvictionManager();
      assertEquals(em.isExpired({ size: 1, timestamp: 1000 }, 1000, 2000), true);
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
      const { tracker, removeCalls } = createMockTracker(["a", "b"]);

      const evictedSize = em.evictLRU(cache, tracker);
      assertEquals(evictedSize, 10);
      assertEquals(cache.has("a"), false);
      assertEquals(cache.has("b"), true);
      assertEquals(
        removeCalls,
        ["a"],
        "evictLRU must deregister the evicted key from the LRU tracker",
      );
    });

    it("should return 0 when nothing to evict", () => {
      const em = new EvictionManager();
      const cache = new Map<string, { size: number }>();
      const { tracker } = createMockTracker([]);

      assertEquals(em.evictLRU(cache, tracker), 0);
    });

    it("should call onEvict callback", () => {
      let evictedKey = "";
      const em = new EvictionManager({
        onEvict: (key) => {
          evictedKey = key;
        },
      });
      const cache = new Map([["a", { size: 5, value: "val" }]]);
      const { tracker } = createMockTracker(["a"]);

      em.evictLRU(cache, tracker);
      assertEquals(evictedKey, "a");
    });
  });

  describe("evictIfNeeded", () => {
    it("should evict to make room by entry count", () => {
      const evictedKeys: string[] = [];
      const em = new EvictionManager({
        onEvict: (key) => {
          evictedKeys.push(key);
        },
      });
      const cache = new Map([
        ["a", { size: 10, value: "a" }],
        ["b", { size: 10, value: "b" }],
      ]);
      const { tracker } = createMockTracker(["a", "b"]);

      em.evictIfNeeded(cache, tracker, 10, 2, 1000);

      assertEquals(
        [...cache.keys()],
        ["b"],
        "evictIfNeeded must drop only the LRU entry needed to make room",
      );
      assertEquals(cache.size, 1, "exactly one entry is evicted for the entry-count limit");
      assertEquals(evictedKeys, ["a"], "onEvict fires once, for the least recently used key");
    });

    it("should evict to make room by memory", () => {
      const em = new EvictionManager();
      const cache = new Map([
        ["a", { size: 50, value: "a" }],
        ["b", { size: 50, value: "b" }],
      ]);
      const { tracker } = createMockTracker(["a", "b"]);

      em.evictIfNeeded(cache, tracker, 10, 100, 80);

      assertEquals(
        [...cache.keys()],
        ["b"],
        "only the LRU entry needed to fit the new entry may be evicted under memory pressure",
      );
      assertEquals(cache.size, 1, "exactly one entry is evicted to fit a 10 byte entry under 80");

      const tightCache = new Map([
        ["a", { size: 50, value: "a" }],
        ["b", { size: 50, value: "b" }],
      ]);
      const tight = createMockTracker(["a", "b"]);

      em.evictIfNeeded(tightCache, tight.tracker, 70, 100, 80);

      assertEquals(
        [...tightCache.keys()],
        [],
        "an entry that only fits in an empty cache evicts every entry",
      );
    });
  });

  describe("evictLRUFromList", () => {
    function createListFixture() {
      const node: LRUNodeInterface<EvictableEntry> = {
        key: "key1",
        entry: { size: 10, value: "v", tags: ["tag-a"] },
        prev: null,
        next: null,
      };
      const store = new Map([["key1", node]]);
      const tagIndex = new Map([["tag-a", new Set(["key1"])]]);
      let tail: LRUNodeInterface<EvictableEntry> | null = node;

      const listManager: LRUListManagerInterface<EvictableEntry> = {
        getTail: () => tail,
        removeNode: (removed) => {
          if (removed === tail) tail = null;
        },
      };

      return { node, store, tagIndex, listManager };
    }

    it("should remove the evicted node from the store and the tag index", () => {
      const em = new EvictionManager();
      const { store, tagIndex, listManager } = createListFixture();

      const size = em.evictLRUFromList(listManager, store, tagIndex, 30);

      assertEquals(store.has("key1"), false, "the evicted node is removed from the store");
      assertEquals(
        tagIndex.has("tag-a"),
        false,
        "evicting the last key for a tag removes the tag from the index",
      );
      assertEquals(size, 20, "the running size drops by the evicted entry size");
    });

    it("should complete the eviction when the onEvict callback throws", () => {
      const em = new EvictionManager({
        onEvict: () => {
          throw new Error("observer failed");
        },
      });
      const { store, tagIndex, listManager } = createListFixture();

      const size = em.evictLRUFromList(listManager, store, tagIndex, 30);

      assertEquals(size, 20, "a throwing onEvict must not abort the eviction pass");
      assertEquals(store.has("key1"), false, "the node is still removed when onEvict throws");
      assertEquals(
        tagIndex.has("tag-a"),
        false,
        "the tag index is still cleaned when onEvict throws",
      );
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
      const { tracker, removeCalls } = createMockTracker(["fresh", "stale"]);

      const evicted = em.evictExpired(cache, tracker, 1000);
      assertEquals(evicted, 1);
      assertEquals(cache.has("stale"), false);
      assertEquals(cache.has("fresh"), true);
      assertEquals(
        removeCalls,
        ["stale"],
        "evictExpired must deregister every expired key from the LRU tracker",
      );
    });

    it("should return 0 when nothing expired", () => {
      const em = new EvictionManager();
      const cache = new Map([["a", { size: 1, timestamp: Date.now() }]]);
      const { tracker } = createMockTracker(["a"]);

      assertEquals(em.evictExpired(cache, tracker, 60000), 0);
    });
  });
});
