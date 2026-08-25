import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertGreater } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { globalModuleCache } from "#veryfront/modules/react-loader/ssr-module-loader/cache/memory.ts";
import { loadMDXModule } from "#veryfront/rendering/ssr/index.ts";
import { getCacheStats } from "#veryfront/utils/memory/index.ts";
import { cleanupBundler } from "./cleanup.ts";

function cacheEntries(name: string): number {
  const stats = getCacheStats().find((cache) => cache.name === name);
  assert(stats, `cache "${name}" must be registered with the memory profiler`);
  return stats.entries;
}

describe("rendering/cleanup", () => {
  describe("cleanupBundler", () => {
    it("should be an async function that returns a promise", async () => {
      const pending = cleanupBundler();
      assert(
        pending instanceof Promise,
        "cleanupBundler must return a Promise so callers can await destroyRendererAdapter before the next test file runs",
      );
      await pending;
    });

    it("should resolve without throwing", async () => {
      // cleanupBundler dynamically imports and clears caches;
      // it should not throw even when modules are already clean
      await cleanupBundler();
    });

    it("clears the registered renderer caches", async () => {
      await loadMDXModule("data:text/javascript,export default () => null");
      globalModuleCache.set("cleanup-test-module", {
        tempPath: "/tmp/cleanup-test-module.js",
        contentHash: "cleanup-test-hash",
      });

      assertGreater(
        cacheEntries("mdx-module-cache"),
        0,
        "mdx module cache must be seeded before cleanup",
      );
      assertGreater(
        cacheEntries("ssr-module-cache"),
        0,
        "ssr module cache must be seeded before cleanup",
      );

      await cleanupBundler();

      assertEquals(
        cacheEntries("mdx-module-cache"),
        0,
        "cleanupBundler must empty the MDX module cache",
      );
      assertEquals(
        cacheEntries("ssr-module-cache"),
        0,
        "cleanupBundler must empty the SSR module cache",
      );
    });
  });
});
