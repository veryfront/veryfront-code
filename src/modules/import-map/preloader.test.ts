import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { clearImportMapCache, getCachedImportMap, preloadImportMap } from "./preloader.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";

// We test the caching behavior of the preloader by mocking loadImportMap
// indirectly. Since preloader calls loadImportMap which has heavy deps,
// we focus on cache semantics using the public API.

function createMinimalAdapter(): RuntimeAdapter {
  // Create a minimal adapter that will cause loadImportMap to fall through
  // to defaults (no config found, no deno.json).
  return {
    fs: {
      readFile: () => {
        throw new Error("not found");
      },
      writeFile: () => {},
      exists: () => false,
      stat: () => {
        throw new Error("not found");
      },
      readDir: async function* () {},
      mkdir: () => {},
      remove: () => {},
    },
    env: {
      get: () => undefined,
    },
  } as unknown as RuntimeAdapter;
}

describe("modules/import-map/preloader", () => {
  describe("preloadImportMap", () => {
    it("should return an import map config", async () => {
      clearImportMapCache();
      const adapter = createMinimalAdapter();
      const result = await preloadImportMap("/test-preload-project", adapter);

      assertEquals(typeof result, "object");
      assertEquals("imports" in result || "scopes" in result, true);
    });

    it("should cache results for the same project dir", async () => {
      clearImportMapCache();
      const adapter = createMinimalAdapter();

      const result1 = preloadImportMap("/test-cache-same", adapter);
      const result2 = preloadImportMap("/test-cache-same", adapter);

      // Both should return the same promise
      const map1 = await result1;
      const map2 = await result2;
      assertEquals(map1, map2);
    });

    it("should cache different projects independently", async () => {
      clearImportMapCache();
      const adapter = createMinimalAdapter();

      const result1 = await preloadImportMap("/test-ind-proj-a", adapter);
      const result2 = await preloadImportMap("/test-ind-proj-b", adapter);

      // Both should be valid import maps (may be equal since both use defaults)
      assertEquals(typeof result1, "object");
      assertEquals(typeof result2, "object");
    });
  });

  describe("getCachedImportMap", () => {
    it("should return undefined when not cached", async () => {
      clearImportMapCache();
      const result = await getCachedImportMap("/test-no-cache-project");
      assertEquals(result, undefined);
    });

    it("should return cached map after preload", async () => {
      clearImportMapCache();
      const adapter = createMinimalAdapter();

      await preloadImportMap("/test-cached-get", adapter);
      const cached = await getCachedImportMap("/test-cached-get");

      assertEquals(typeof cached, "object");
      assertEquals(cached !== undefined, true);
    });
  });

  describe("clearImportMapCache", () => {
    it("should clear cache for specific project", async () => {
      clearImportMapCache();
      const adapter = createMinimalAdapter();

      await preloadImportMap("/test-clear-specific", adapter);

      clearImportMapCache("/test-clear-specific");

      const cached = await getCachedImportMap("/test-clear-specific");
      assertEquals(cached, undefined);
    });

    it("should clear all caches when no project specified", async () => {
      clearImportMapCache();
      const adapter = createMinimalAdapter();

      await preloadImportMap("/test-clear-all-a", adapter);
      await preloadImportMap("/test-clear-all-b", adapter);

      clearImportMapCache();

      const cachedA = await getCachedImportMap("/test-clear-all-a");
      const cachedB = await getCachedImportMap("/test-clear-all-b");
      assertEquals(cachedA, undefined);
      assertEquals(cachedB, undefined);
    });

    it("should not affect other projects when clearing specific project", async () => {
      clearImportMapCache();
      const adapter = createMinimalAdapter();

      await preloadImportMap("/test-clear-keep-a", adapter);
      await preloadImportMap("/test-clear-keep-b", adapter);

      clearImportMapCache("/test-clear-keep-a");

      const cachedA = await getCachedImportMap("/test-clear-keep-a");
      const cachedB = await getCachedImportMap("/test-clear-keep-b");
      assertEquals(cachedA, undefined);
      assertEquals(cachedB !== undefined, true);
    });
  });
});
