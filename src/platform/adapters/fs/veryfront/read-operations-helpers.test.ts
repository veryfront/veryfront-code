import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { buildFileCacheKeyPrefix } from "./cache-keys.ts";
import {
  assertProjectSourcePath,
  buildReadFetchState,
  getResolvedCacheKey,
  isNotFoundLikeError,
  READ_OPERATION_EXTENSION_PRIORITY,
  splitKnownFileExtension,
} from "./read-operations-helpers.ts";
import type { ResolvedContentContext } from "./types.ts";

describe("read-operations helpers", () => {
  describe("assertProjectSourcePath", () => {
    it("allows project source paths", () => {
      assertProjectSourcePath("pages/index.tsx");
    });

    it("throws for framework source paths", () => {
      assertThrows(
        () => assertProjectSourcePath("_veryfront/react/component"),
        Error,
        "cannot be fetched from API",
      );
    });
  });

  describe("buildReadFetchState", () => {
    it("builds branch mode state", () => {
      const context: ResolvedContentContext = {
        sourceType: "branch",
        projectSlug: "demo",
        branch: "main",
      };

      const state = buildReadFetchState({
        normalizedPath: "pages/index.tsx",
        contentContext: context,
        contextProvider: { isProductionMode: () => false },
        getOriginalApiPath: (path) => `source/${path}`,
      });

      assertEquals(state.apiPath, "source/pages/index.tsx");
      assertEquals(state.cacheKeyPrefix, buildFileCacheKeyPrefix(context));
      assertEquals(state.cacheKey, `${buildFileCacheKeyPrefix(context)}:pages/index.tsx`);
      assertEquals(state.hasKnownExtension, true);
      assertEquals(state.isPreviewMode, true);
      assertEquals(state.isPublished, false);
      assertEquals(state.releaseId, undefined);
      assertEquals(state.skipPersistentCaches, false);
    });

    it("builds production invalidation state", () => {
      const context: ResolvedContentContext = {
        sourceType: "release",
        projectSlug: "demo",
        releaseId: "rel-123",
      };

      const state = buildReadFetchState({
        normalizedPath: "pages/index",
        contentContext: context,
        contextProvider: {
          isProductionMode: () => true,
          isPersistentCacheInvalidated: () => true,
          isReleaseBeingInvalidated: () => true,
        },
      });

      assertEquals(state.apiPath, "pages/index");
      assertEquals(state.hasKnownExtension, false);
      assertEquals(state.isPreviewMode, false);
      assertEquals(state.isPublished, true);
      assertEquals(state.releaseId, "rel-123");
      assertEquals(state.isPrefixInvalidated, true);
      assertEquals(state.isReleaseInvalidated, true);
      assertEquals(state.skipPersistentCaches, true);
    });
  });

  describe("utility helpers", () => {
    it("preserves read extension priority order", () => {
      assertEquals(READ_OPERATION_EXTENSION_PRIORITY, [
        ".tsx",
        ".ts",
        ".jsx",
        ".js",
        ".mdx",
        ".md",
      ]);
    });

    it("builds resolved cache keys", () => {
      assertEquals(
        getResolvedCacheKey("file:branch:demo:main", "pages/index.tsx"),
        "file:branch:demo:main:pages/index.tsx",
      );
    });

    it("splits known file extensions", () => {
      assertEquals(splitKnownFileExtension("pages/index.tsx"), {
        originalExtension: ".tsx",
        basePath: "pages/index",
      });
      assertEquals(splitKnownFileExtension("pages/index"), null);
    });

    it("detects not-found-like errors", () => {
      assertEquals(isNotFoundLikeError(new Error("404 Not Found")), true);
      assertEquals(isNotFoundLikeError("Not Found"), true);
      assertEquals(isNotFoundLikeError(new Error("500 Internal Server Error")), false);
    });
  });
});
