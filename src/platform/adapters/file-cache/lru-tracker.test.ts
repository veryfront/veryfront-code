import { describe, it } from "std/testing/bdd.ts";
import { assertEquals } from "std/assert/mod.ts";
import { LRUTracker } from "./lru-tracker.ts";

describe("platform/adapters/file-cache/lru-tracker", () => {
  describe("LRUTracker", () => {
    it("should start with size 0", () => {
      const tracker = new LRUTracker();
      assertEquals(tracker.size, 0);
    });

    it("should return undefined for getLRU when empty", () => {
      const tracker = new LRUTracker();
      assertEquals(tracker.getLRU(), undefined);
    });

    it("should track single item", () => {
      const tracker = new LRUTracker();
      tracker.update("key1");

      assertEquals(tracker.size, 1);
      assertEquals(tracker.getLRU(), "key1");
    });

    it("should track multiple items in order", () => {
      const tracker = new LRUTracker();
      tracker.update("key1");
      tracker.update("key2");
      tracker.update("key3");

      assertEquals(tracker.size, 3);
      assertEquals(tracker.getLRU(), "key1");
    });

    it("should move item to end when updated", () => {
      const tracker = new LRUTracker();
      tracker.update("key1");
      tracker.update("key2");
      tracker.update("key3");
      tracker.update("key1"); // Move key1 to end

      assertEquals(tracker.getLRU(), "key2");
    });

    it("should handle updating same key multiple times", () => {
      const tracker = new LRUTracker();
      tracker.update("key1");
      tracker.update("key1");
      tracker.update("key1");

      assertEquals(tracker.size, 1);
      assertEquals(tracker.getLRU(), "key1");
    });

    it("should remove items", () => {
      const tracker = new LRUTracker();
      tracker.update("key1");
      tracker.update("key2");
      tracker.update("key3");

      tracker.remove("key2");

      assertEquals(tracker.size, 2);
      assertEquals(tracker.getLRU(), "key1");
    });

    it("should handle removing first item", () => {
      const tracker = new LRUTracker();
      tracker.update("key1");
      tracker.update("key2");
      tracker.update("key3");

      tracker.remove("key1");

      assertEquals(tracker.size, 2);
      assertEquals(tracker.getLRU(), "key2");
    });

    it("should handle removing non-existent item", () => {
      const tracker = new LRUTracker();
      tracker.update("key1");
      tracker.update("key2");

      tracker.remove("key3");

      assertEquals(tracker.size, 2);
      assertEquals(tracker.getLRU(), "key1");
    });

    it("should clear all items", () => {
      const tracker = new LRUTracker();
      tracker.update("key1");
      tracker.update("key2");
      tracker.update("key3");

      tracker.clear();

      assertEquals(tracker.size, 0);
      assertEquals(tracker.getLRU(), undefined);
    });

    it("should handle complex scenario", () => {
      const tracker = new LRUTracker();

      // Add items
      tracker.update("a");
      tracker.update("b");
      tracker.update("c");
      assertEquals(tracker.getLRU(), "a");

      // Access 'a' again
      tracker.update("a");
      assertEquals(tracker.getLRU(), "b");

      // Remove 'b'
      tracker.remove("b");
      assertEquals(tracker.getLRU(), "c");

      // Add new item
      tracker.update("d");
      assertEquals(tracker.getLRU(), "c");
    });
  });
});
