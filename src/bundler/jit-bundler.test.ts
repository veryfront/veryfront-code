import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { invalidateProjectBundles } from "./jit-bundler.ts";
import { resetBundleCache } from "./bundle-cache.ts";

/**
 * JIT Bundler tests
 *
 * Note: The buildBundleFromFiles function requires proper esbuild virtual filesystem
 * setup which is complex to test in isolation. The core functionality is tested
 * through integration tests. These unit tests focus on the supporting functions
 * and error handling.
 */
describe("bundler/jit-bundler", () => {
  beforeEach(() => {
    resetBundleCache();
  });

  afterEach(() => {
    resetBundleCache();
  });

  describe("invalidateProjectBundles", () => {
    it("should not throw when invalidating non-existent project", async () => {
      // Should not throw
      await invalidateProjectBundles("non-existent-project");
    });

    it("should invalidate bundles for project", async () => {
      // This mainly tests that the function doesn't throw
      // Actual cache clearing depends on API being available
      await invalidateProjectBundles("test-project");
    });

    it("should handle multiple calls for same project", async () => {
      await invalidateProjectBundles("test-project");
      await invalidateProjectBundles("test-project");
      // Should complete without error
    });

    it("should handle concurrent invalidation calls", async () => {
      await Promise.all([
        invalidateProjectBundles("project-1"),
        invalidateProjectBundles("project-2"),
        invalidateProjectBundles("project-3"),
      ]);
      // Should complete without error
    });
  });

  describe("cache integration", () => {
    it("should use bundle cache singleton", async () => {
      // Just verify the cache is accessible
      const { getBundleCache } = await import("./bundle-cache.ts");
      const cache = getBundleCache();
      assertExists(cache);
    });

    it("should handle cache misses gracefully", async () => {
      const { getBundleCache } = await import("./bundle-cache.ts");
      const cache = getBundleCache();

      const result = await cache.get("nonexistent-project", "nonexistent-hash");
      assertEquals(result, null);
    });
  });
});
