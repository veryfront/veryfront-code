import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createLayoutComponentCache, type LayoutComponentCache } from "./component-loader.ts";

// We test the InMemoryLayoutComponentCache through the factory function

describe("rendering/layouts/utils/component-loader", () => {
  describe("createLayoutComponentCache", () => {
    it("should create a cache with default max entries", () => {
      const cache = createLayoutComponentCache();
      assertEquals(typeof cache.get, "function");
      assertEquals(typeof cache.set, "function");
      assertEquals(typeof cache.delete, "function");
      assertEquals(typeof cache.clear, "function");
    });

    it("should create a cache with custom max entries", () => {
      const cache = createLayoutComponentCache(10);
      assertEquals(typeof cache.get, "function");
    });
  });

  describe("InMemoryLayoutComponentCache (via factory)", () => {
    function DummyComponent() {
      return null;
    }
    function AnotherComponent() {
      return null;
    }

    it("should return undefined for missing keys", () => {
      const cache = createLayoutComponentCache();
      assertEquals(cache.get("nonexistent"), undefined);
    });

    it("should set and get a component", () => {
      const cache = createLayoutComponentCache();
      cache.set("key1", DummyComponent);
      assertEquals(cache.get("key1"), DummyComponent);
    });

    it("should overwrite existing key", () => {
      const cache = createLayoutComponentCache();
      cache.set("key1", DummyComponent);
      cache.set("key1", AnotherComponent);
      assertEquals(cache.get("key1"), AnotherComponent);
    });

    it("should delete a key", () => {
      const cache = createLayoutComponentCache();
      cache.set("key1", DummyComponent);
      cache.delete("key1");
      assertEquals(cache.get("key1"), undefined);
    });

    it("should clear all entries", () => {
      const cache = createLayoutComponentCache();
      cache.set("key1", DummyComponent);
      cache.set("key2", AnotherComponent);
      cache.clear();
      assertEquals(cache.get("key1"), undefined);
      assertEquals(cache.get("key2"), undefined);
    });

    it("should evict oldest entry when maxEntries is reached", () => {
      const cache = createLayoutComponentCache(2);

      const C1 = () => null;
      const C2 = () => null;
      const C3 = () => null;

      cache.set("k1", C1);
      cache.set("k2", C2);
      // This should evict k1
      cache.set("k3", C3);

      assertEquals(cache.get("k1"), undefined);
      assertEquals(cache.get("k2"), C2);
      assertEquals(cache.get("k3"), C3);
    });

    it("should promote accessed entries (LRU behavior)", () => {
      const cache = createLayoutComponentCache(2);

      const C1 = () => null;
      const C2 = () => null;
      const C3 = () => null;

      cache.set("k1", C1);
      cache.set("k2", C2);

      // Access k1 to promote it
      cache.get("k1");

      // Now k2 should be the oldest, so adding k3 should evict k2
      cache.set("k3", C3);

      assertEquals(cache.get("k1"), C1);
      assertEquals(cache.get("k2"), undefined);
      assertEquals(cache.get("k3"), C3);
    });

    it("should handle clearForProject", () => {
      const cache = createLayoutComponentCache();
      const C1 = () => null;
      const C2 = () => null;

      cache.set("layout:project1:/path1:hash1:csid1", C1);
      cache.set("layout:project2:/path2:hash2:csid2", C2);

      cache.clearForProject?.("project1");

      assertEquals(cache.get("layout:project1:/path1:hash1:csid1"), undefined);
      assertEquals(cache.get("layout:project2:/path2:hash2:csid2"), C2);
    });

    it("should handle delete of non-existing key", () => {
      const cache = createLayoutComponentCache();
      cache.delete("nonexistent"); // Should not throw
    });

    it("should handle maxEntries of 1", () => {
      const cache = createLayoutComponentCache(1);
      const C1 = () => null;
      const C2 = () => null;

      cache.set("k1", C1);
      cache.set("k2", C2);

      assertEquals(cache.get("k1"), undefined);
      assertEquals(cache.get("k2"), C2);
    });
  });
});
