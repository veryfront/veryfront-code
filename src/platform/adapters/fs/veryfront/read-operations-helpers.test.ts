import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { buildFileCacheKeyPrefix } from "./cache-keys.ts";
import {
  assertProjectSourcePath,
  buildReadFetchState,
  createNotFoundLikeError,
  getResolvedCacheKey,
  isNotFoundLikeError,
  READ_OPERATION_EXTENSION_PRIORITY,
  splitKnownFileExtension,
} from "./read-operations-helpers.ts";
import { VeryfrontError } from "#veryfront/errors";
import { isCanonicalNotFoundError } from "#veryfront/platform/compat/not-found-error.ts";
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

    it("keeps optional-read identities distinct from valid file paths", () => {
      const context: ResolvedContentContext = {
        sourceType: "branch",
        projectSlug: "demo",
        branch: "main",
      };
      const ordinary = buildReadFetchState({
        normalizedPath: "optional-exact:globals.css",
        contentContext: context,
      });
      const optional = buildReadFetchState({
        normalizedPath: "globals.css",
        contentContext: context,
        cacheVariant: "optional-exact",
      });

      assertEquals(ordinary.cacheKey === optional.cacheKey, false);
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
      assertEquals(
        isNotFoundLikeError(Object.assign(new Error("not found"), { status: 404 })),
        true,
      );
      assertEquals(
        isNotFoundLikeError(Object.assign(new Error("missing"), { code: "ENOENT" })),
        true,
      );
      assertEquals(isNotFoundLikeError(new Error("500 Internal Server Error")), false);
    });

    it("raises the registry file-not-found error, not a raw Error", () => {
      const error = createNotFoundLikeError("app/layout.tsx");

      assertEquals(
        error instanceof VeryfrontError,
        true,
        "the adapter's absence error must carry a registry identity",
      );
      assertEquals(
        (error as VeryfrontError).slug,
        "file-not-found",
        "slug is what resolveSSRFailure reads to answer 404",
      );
      assertEquals((error as VeryfrontError).status, 404, "file-not-found is a 404 condition");
      assertEquals(error.message, "404 Not Found: app/layout.tsx", "message shape is unchanged");
    });

    it("keeps the ENOENT contract its own callers depend on", () => {
      const error = createNotFoundLikeError("app/layout.tsx");

      assertEquals(error.code, "ENOENT", "isNotFoundLikeError and Node-style checks read code");
      assertEquals(
        isNotFoundLikeError(error),
        true,
        "the adapter's own optional-file catches must still treat it as a miss",
      );
      assertEquals(
        isCanonicalNotFoundError(error),
        true,
        "fail-closed filesystem boundaries must still see ordinary absence",
      );
    });
  });
});
