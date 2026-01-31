import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { LRUTracker } from "./lru-tracker.ts";

describe("LRUTracker", () => {
  let tracker: LRUTracker;

  beforeEach(() => {
    tracker = new LRUTracker();
  });

  afterEach(() => {
    tracker.clear();
  });

  describe("class instantiation", () => {
    it("should be instantiable", () => {
      assertExists(new LRUTracker());
    });

    it("should start with empty size", () => {
      assertEquals(tracker.size, 0);
    });
  });

  describe("update", () => {
    it("should add new key", () => {
      tracker.update("key1");

      assertEquals(tracker.size, 1);
    });

    it("should move existing key to end", () => {
      tracker.update("key1");
      tracker.update("key2");
      tracker.update("key1");

      assertEquals(tracker.getLRU(), "key2");
    });

    it("should handle multiple keys", () => {
      tracker.update("key1");
      tracker.update("key2");
      tracker.update("key3");

      assertEquals(tracker.size, 3);
      assertEquals(tracker.getLRU(), "key1");
    });
  });

  describe("remove", () => {
    it("should remove existing key", () => {
      tracker.update("key1");
      tracker.update("key2");
      tracker.remove("key1");

      assertEquals(tracker.size, 1);
      assertEquals(tracker.getLRU(), "key2");
    });

    it("should handle removing non-existent key", () => {
      tracker.update("key1");
      tracker.remove("non-existent");

      assertEquals(tracker.size, 1);
    });
  });

  describe("getLRU", () => {
    it("should return undefined for empty tracker", () => {
      assertEquals(tracker.getLRU(), undefined);
    });

    it("should return least recently used key", () => {
      tracker.update("key1");
      tracker.update("key2");
      tracker.update("key3");

      assertEquals(tracker.getLRU(), "key1");
    });

    it("should update after access", () => {
      tracker.update("key1");
      tracker.update("key2");
      tracker.update("key1");

      assertEquals(tracker.getLRU(), "key2");
    });
  });

  describe("size", () => {
    it("should return correct size", () => {
      assertEquals(tracker.size, 0);

      tracker.update("key1");
      assertEquals(tracker.size, 1);

      tracker.update("key2");
      assertEquals(tracker.size, 2);

      tracker.remove("key1");
      assertEquals(tracker.size, 1);
    });
  });

  describe("clear", () => {
    it("should clear all entries", () => {
      tracker.update("key1");
      tracker.update("key2");
      tracker.clear();

      assertEquals(tracker.size, 0);
      assertEquals(tracker.getLRU(), undefined);
    });
  });
});
