import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  extractProjectIdFromKey,
  isKeyForProject,
  isKeyForProjectEnvironment,
  LRUCacheStore,
  MapCacheStore,
} from "./registry.ts";

describe("cache/registry", () => {
  describe("MapCacheStore", () => {
    it("should expose name", () => {
      const store = new MapCacheStore("test", new Map());
      assertEquals(store.name, "test");
    });

    it("should report size", () => {
      const map = new Map<string, unknown>([["a", 1], ["b", 2]]);
      const store = new MapCacheStore("test", map);
      assertEquals(store.size(), 2);
    });

    it("should iterate keys", () => {
      const map = new Map<string, unknown>([["a", 1], ["b", 2]]);
      const store = new MapCacheStore("test", map);
      assertEquals([...store.keys()].sort(), ["a", "b"]);
    });

    it("should delete matching keys", () => {
      const map = new Map<string, unknown>([["proj1:a", 1], ["proj2:b", 2], ["proj1:c", 3]]);
      const store = new MapCacheStore("test", map);
      const deleted = store.deleteWhere((key) => key.startsWith("proj1:"));
      assertEquals(deleted, 2);
      assertEquals(map.size, 1);
      assertEquals(map.has("proj2:b"), true);
    });
  });

  describe("LRUCacheStore", () => {
    function createMockLRU() {
      const map = new Map<string, unknown>();
      return {
        keys: () => map.keys(),
        get size() {
          return map.size;
        },
        delete: (key: string) => map.delete(key),
        set: (key: string, value: unknown) => {
          map.set(key, value);
        },
        _map: map,
      };
    }

    it("should expose name", () => {
      const store = new LRUCacheStore("lru-test", createMockLRU());
      assertEquals(store.name, "lru-test");
    });

    it("should report size", () => {
      const lru = createMockLRU();
      lru.set("a", 1);
      lru.set("b", 2);
      const store = new LRUCacheStore("test", lru);
      assertEquals(store.size(), 2);
    });

    it("should delete matching keys", () => {
      const lru = createMockLRU();
      lru.set("proj1:a", 1);
      lru.set("proj2:b", 2);
      const store = new LRUCacheStore("test", lru);
      const deleted = store.deleteWhere((key) => key.startsWith("proj1:"));
      assertEquals(deleted, 1);
      assertEquals(lru.size, 1);
    });
  });

  describe("isKeyForProject", () => {
    it("should match projectId at position 1", () => {
      assertEquals(isKeyForProject("prefix:project123:rest", "project123"), true);
    });

    it("should match projectId at position 2", () => {
      assertEquals(isKeyForProject("prefix:other:project123:rest", "project123"), true);
    });

    it("should match projectId anywhere in parts", () => {
      assertEquals(isKeyForProject("a:b:c:project123", "project123"), true);
    });

    it("should return false for non-matching key", () => {
      assertEquals(isKeyForProject("a:b:c", "project123"), false);
    });

    it("should return false for single-part key", () => {
      assertEquals(isKeyForProject("nocolon", "project123"), false);
    });
  });

  describe("isKeyForProjectEnvironment", () => {
    it("should match production environment in render cache keys", () => {
      assertEquals(
        isKeyForProjectEnvironment("proj1:production:release-1:v1", "proj1", "production"),
        true,
      );
    });

    it("should match preview environment in render cache keys", () => {
      assertEquals(
        isKeyForProjectEnvironment("proj1:preview:branch-main:v1", "proj1", "preview"),
        true,
      );
    });

    it("should return false for wrong environment", () => {
      assertEquals(
        isKeyForProjectEnvironment("proj1:production:release-1:v1", "proj1", "preview"),
        false,
      );
    });

    it("should match preview via SSR module key with preview prefix", () => {
      assertEquals(
        isKeyForProjectEnvironment("v19:proj1:preview-draft:hash", "proj1", "preview"),
        true,
      );
    });

    it("should match production via SSR module key with release prefix", () => {
      assertEquals(
        isKeyForProjectEnvironment("v19:proj1:release-abc:hash", "proj1", "production"),
        true,
      );
    });

    it("should match file cache branch as preview", () => {
      assertEquals(
        isKeyForProjectEnvironment("file:branch:proj1:main:path", "proj1", "preview"),
        true,
      );
    });

    it("should match file cache release as production", () => {
      assertEquals(
        isKeyForProjectEnvironment("file:release:proj1:v1:path", "proj1", "production"),
        true,
      );
    });
  });

  describe("extractProjectIdFromKey", () => {
    it("should extract second part as projectId", () => {
      assertEquals(extractProjectIdFromKey("prefix:project123:rest"), "project123");
    });

    it("should return null for single-part key", () => {
      assertEquals(extractProjectIdFromKey("nocolon"), null);
    });
  });
});
