import "../../_helpers/contract-init.ts";
import { assertEquals } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import {
  buildSourceMissCacheKey,
  clearSourceMissCache,
  hasSourceMiss,
  rememberSourceMiss,
} from "../../../src/modules/server/module-source-resolution-cache.ts";
import { invalidateProjectCaches } from "../../../src/server/context/cache-invalidation.ts";

describe("cache-invalidation", () => {
  describe("invalidateProjectCaches", () => {
    it("invalidates caches without throwing", () => {
      invalidateProjectCaches("test-project");
    });

    it("supports selective invalidation with specific file paths", () => {
      invalidateProjectCaches("test-project", [
        "pages/index.mdx",
        "components/Button.tsx",
      ]);
    });

    it("clears all caches when no paths provided", () => {
      invalidateProjectCaches("test-project");
    });

    it("clears source miss caches", async () => {
      const cacheKey = buildSourceMissCacheKey({
        resolver: "module-server",
        projectDir: "/test-project",
        projectSlug: "test-project",
        basePath: "components/Missing",
      });
      const unrelatedCacheKey = buildSourceMissCacheKey({
        resolver: "module-server",
        projectDir: "/other-project",
        projectSlug: "other-project",
        basePath: "components/Missing",
      });
      rememberSourceMiss(cacheKey);
      rememberSourceMiss(unrelatedCacheKey);
      assertEquals(hasSourceMiss(cacheKey), true);
      assertEquals(hasSourceMiss(unrelatedCacheKey), true);

      try {
        await invalidateProjectCaches("test-project");

        assertEquals(hasSourceMiss(cacheKey), false);
        assertEquals(
          hasSourceMiss(unrelatedCacheKey),
          true,
          "Project invalidation must not evict another tenant's miss entries",
        );
      } finally {
        clearSourceMissCache();
      }
    });
  });
});
