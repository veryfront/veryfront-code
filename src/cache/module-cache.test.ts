import { assertEquals, assertNotEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  clearModuleCacheForProject,
  clearModuleCaches,
  createEsmCache,
  createModuleCache,
  destroyModuleCaches,
  getEsmCache,
  getModuleCache,
  getModuleCacheStats,
} from "./module-cache.ts";

describe("cache/module-cache", () => {
  afterEach(() => {
    destroyModuleCaches();
  });

  describe("getModuleCache", () => {
    it("should return an LRUCache instance", () => {
      const cache = getModuleCache();
      assertNotEquals(cache, null);
      assertNotEquals(cache, undefined);
    });

    it("should return the same singleton on repeated calls", () => {
      assertEquals(getModuleCache(), getModuleCache());
    });

    it("should support basic get/set/has operations", () => {
      const cache = getModuleCache();
      cache.set("proj1:file.ts", "/tmp/file.js");

      assertEquals(cache.has("proj1:file.ts"), true);
      assertEquals(cache.get("proj1:file.ts"), "/tmp/file.js");
      assertEquals(cache.has("nonexistent"), false);
      assertEquals(cache.get("nonexistent"), undefined);
    });

    it("should support delete", () => {
      const cache = getModuleCache();
      cache.set("key", "val");

      assertEquals(cache.delete("key"), true);
      assertEquals(cache.has("key"), false);
    });
  });

  describe("getEsmCache", () => {
    it("should return an LRUCache instance", () => {
      const cache = getEsmCache();
      assertNotEquals(cache, null);
      assertNotEquals(cache, undefined);
    });

    it("should return the same singleton on repeated calls", () => {
      assertEquals(getEsmCache(), getEsmCache());
    });

    it("should be a different instance than the module cache", () => {
      assertNotEquals(getModuleCache(), getEsmCache());
    });
  });

  describe("createModuleCache", () => {
    it("should return a Map-compatible interface", () => {
      const map = createModuleCache();
      map.set("key1", "value1");

      assertEquals(map.get("key1"), "value1");
      assertEquals(map.has("key1"), true);
      assertEquals(map.size, 1);
    });

    it("should be backed by the same singleton LRU cache", () => {
      const map = createModuleCache();
      const cache = getModuleCache();

      map.set("shared-key", "shared-value");
      assertEquals(cache.get("shared-key"), "shared-value");
    });

    it("should support delete", () => {
      const map = createModuleCache();
      map.set("del-key", "val");

      assertEquals(map.delete("del-key"), true);
      assertEquals(map.has("del-key"), false);
    });

    it("should support clear", () => {
      const map = createModuleCache();
      map.set("a", "1");
      map.set("b", "2");

      map.clear();
      assertEquals(map.size, 0);
    });

    it("should support iteration via keys()", () => {
      const map = createModuleCache();
      map.set("k1", "v1");
      map.set("k2", "v2");

      assertEquals([...map.keys()].sort(), ["k1", "k2"]);
    });

    it("should support iteration via values()", () => {
      const map = createModuleCache();
      map.set("k1", "v1");
      map.set("k2", "v2");

      assertEquals([...map.values()].sort(), ["v1", "v2"]);
    });

    it("should support iteration via entries()", () => {
      const map = createModuleCache();
      map.set("k1", "v1");
      map.set("k2", "v2");

      const entries = [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
      assertEquals(entries, [
        ["k1", "v1"],
        ["k2", "v2"],
      ]);
    });

    it("should support forEach", () => {
      const map = createModuleCache();
      map.set("k1", "v1");

      const collected: Array<[string, string]> = [];
      map.forEach((value, key) => collected.push([key, value]));

      assertEquals(collected, [["k1", "v1"]]);
    });

    it("should support Symbol.iterator", () => {
      const map = createModuleCache();
      map.set("k1", "v1");

      const entries: Array<[string, string]> = [];
      for (const entry of map) entries.push(entry);

      assertEquals(entries, [["k1", "v1"]]);
    });

    it("should return itself from set() for chaining", () => {
      const map = createModuleCache();
      assertEquals(map.set("k", "v"), map);
    });
  });

  describe("createEsmCache", () => {
    it("should return a Map-compatible interface backed by the ESM singleton", () => {
      const map = createEsmCache();
      const cache = getEsmCache();

      map.set("esm-key", "esm-val");
      assertEquals(cache.get("esm-key"), "esm-val");
    });
  });

  describe("getModuleCacheStats", () => {
    it("should return zero sizes when caches are not initialized", () => {
      const stats = getModuleCacheStats();
      assertEquals(stats.moduleCache.size, 0);
      assertEquals(stats.esmCache.size, 0);
    });

    it("should reflect module cache entries", () => {
      const cache = getModuleCache();
      cache.set("k1", "v1");
      cache.set("k2", "v2");

      assertEquals(getModuleCacheStats().moduleCache.size, 2);
    });

    it("should reflect ESM cache entries", () => {
      getEsmCache().set("e1", "v1");
      assertEquals(getModuleCacheStats().esmCache.size, 1);
    });
  });

  describe("clearModuleCaches", () => {
    it("should clear both module and ESM caches", () => {
      getModuleCache().set("m1", "v1");
      getEsmCache().set("e1", "v1");

      clearModuleCaches();

      assertEquals(getModuleCache().size, 0);
      assertEquals(getEsmCache().size, 0);
    });

    it("should not throw when caches are not initialized", () => {
      clearModuleCaches();
    });
  });

  describe("clearModuleCacheForProject", () => {
    it("should return 0 when module cache is not initialized", () => {
      assertEquals(clearModuleCacheForProject("proj1"), 0);
    });

    it("should clear only entries for the specified project", () => {
      const cache = getModuleCache();
      cache.set("proj1:file-a.ts", "/tmp/a.js");
      cache.set("proj1:file-b.ts", "/tmp/b.js");
      cache.set("proj2:file-c.ts", "/tmp/c.js");

      assertEquals(clearModuleCacheForProject("proj1"), 2);
      assertEquals(cache.has("proj1:file-a.ts"), false);
      assertEquals(cache.has("proj1:file-b.ts"), false);
      assertEquals(cache.has("proj2:file-c.ts"), true);
    });

    it("should return 0 when no entries match the project", () => {
      getModuleCache().set("proj2:file.ts", "/tmp/file.js");
      assertEquals(clearModuleCacheForProject("proj1"), 0);
    });
  });

  describe("destroyModuleCaches", () => {
    it("should destroy and nullify both caches", () => {
      getModuleCache().set("m1", "v1");
      getEsmCache().set("e1", "v1");

      destroyModuleCaches();

      assertEquals(getModuleCache().size, 0);
    });

    it("should be safe to call multiple times", () => {
      destroyModuleCaches();
      destroyModuleCaches();
    });
  });
});
