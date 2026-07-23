import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotEquals, assertThrows } from "#veryfront/testing/assert.ts";
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
import { buildPodModuleCacheKey } from "./keys/builders/module.ts";
import { cacheRegistry } from "./registry.ts";

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

    it("does not rewrite LRU recency while iterating values", () => {
      const map = createModuleCache();
      const capacity = getModuleCacheStats().moduleCache.maxEntries;
      for (let index = 0; index < capacity; index++) {
        map.set(`k${index}`, `v${index}`);
      }
      assertEquals(map.get("k0"), "v0");

      for (const _value of map.values()) {
        // Consume the iterator completely.
      }
      map.set("overflow", "value");

      assertEquals(map.has("k0"), true);
      assertEquals(map.has("k1"), false);
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

    it("should support getOrInsert", () => {
      const map = createModuleCache();

      assertEquals(map.getOrInsert("k1", "v1"), "v1");
      assertEquals(map.get("k1"), "v1");
      assertEquals(map.getOrInsert("k1", "ignored"), "v1");
      assertEquals(map.get("k1"), "v1");
    });

    it("should support getOrInsertComputed", () => {
      const map = createModuleCache();

      let calls = 0;
      assertEquals(
        map.getOrInsertComputed("k1", (key) => {
          calls++;
          return `${key}-value`;
        }),
        "k1-value",
      );
      assertEquals(map.get("k1"), "k1-value");
      assertEquals(
        map.getOrInsertComputed("k1", () => {
          calls++;
          return "ignored";
        }),
        "k1-value",
      );
      assertEquals(calls, 1);
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
    it("rejects an invalid project identity", () => {
      assertThrows(() => clearModuleCacheForProject(""), Error);
    });

    it("should return 0 when module cache is not initialized", () => {
      assertEquals(clearModuleCacheForProject("proj1"), 0);
    });

    it("should clear only entries for the specified project", () => {
      const cache = getModuleCache();
      const projectOneA = buildPodModuleCacheKey("file-a.ts", "proj1");
      const projectOneB = buildPodModuleCacheKey("file-b.ts", "proj1");
      const projectTwo = buildPodModuleCacheKey("file-c.ts", "proj2");
      cache.set(projectOneA, "/tmp/a.js");
      cache.set(projectOneB, "/tmp/b.js");
      cache.set(projectTwo, "/tmp/c.js");

      assertEquals(clearModuleCacheForProject("proj1"), 2);
      assertEquals(cache.has(projectOneA), false);
      assertEquals(cache.has(projectOneB), false);
      assertEquals(cache.has(projectTwo), true);
    });

    it("should return 0 when no entries match the project", () => {
      getModuleCache().set(buildPodModuleCacheKey("file.ts", "proj2"), "/tmp/file.js");
      assertEquals(clearModuleCacheForProject("proj1"), 0);
    });

    it("matches delimiter-bearing project identities exactly", () => {
      const cache = getModuleCache();
      const parent = buildPodModuleCacheKey("parent.ts", "tenant");
      const child = buildPodModuleCacheKey("child.ts", "tenant:child");
      cache.set(parent, "/tmp/parent.js");
      cache.set(child, "/tmp/child.js");

      assertEquals(clearModuleCacheForProject("tenant"), 1);
      assertEquals(cache.has(parent), false);
      assertEquals(cache.has(child), true);
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

    it("unregisters destroyed caches from diagnostics", () => {
      getModuleCache();
      getEsmCache();
      assertEquals(cacheRegistry.getStoreNames().includes("pod-module-cache"), true);
      assertEquals(cacheRegistry.getStoreNames().includes("pod-esm-cache"), true);

      destroyModuleCaches();

      assertEquals(cacheRegistry.getStoreNames().includes("pod-module-cache"), false);
      assertEquals(cacheRegistry.getStoreNames().includes("pod-esm-cache"), false);
    });
  });
});
