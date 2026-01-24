import { describe, it } from "@veryfront/testing/bdd";
import { assertEquals, assertThrows } from "@veryfront/testing/assert";
import {
  type CacheKeyContext,
  getContentHashKey,
  getCurrentCacheKeyContext,
  getProjectScopedKey,
  getProjectScopedKeyAlways,
  runWithCacheKeyContext,
  tryGetCacheKeyContext,
} from "./cache-key-builder.ts";

describe("cache-key-builder", () => {
  describe("getContentHashKey", () => {
    it("should build key without suffix", () => {
      assertEquals(
        getContentHashKey("prefix", "pages/index.tsx", "abc123"),
        "prefix:pages/index.tsx:abc123",
      );
    });

    it("should build key with suffix", () => {
      assertEquals(
        getContentHashKey("prefix", "pages/index.tsx", "abc123", "ssr"),
        "prefix:pages/index.tsx:abc123:ssr",
      );
    });
  });

  describe("runWithCacheKeyContext", () => {
    it("should provide context within callback", () => {
      const ctx: CacheKeyContext = {
        projectId: "test-project",
        mode: "production",
        versionId: "rel_123",
      };

      const result = runWithCacheKeyContext(ctx, getCurrentCacheKeyContext);

      assertEquals(result.projectId, "test-project");
      assertEquals(result.mode, "production");
      assertEquals(result.versionId, "rel_123");
    });

    it("should throw on invalid context", () => {
      const invalidCtx: CacheKeyContext = {
        projectId: "",
        mode: "production",
        versionId: "rel_123",
      };

      assertThrows(() => runWithCacheKeyContext(invalidCtx, () => {}), Error);
    });
  });

  describe("getCurrentCacheKeyContext", () => {
    it("should throw when no context set", () => {
      assertThrows(() => getCurrentCacheKeyContext(), Error, "No cache context available");
    });
  });

  describe("tryGetCacheKeyContext", () => {
    it("should return null when no context set", () => {
      assertEquals(tryGetCacheKeyContext(), null);
    });

    it("should return context when set", () => {
      const ctx: CacheKeyContext = {
        projectId: "test",
        mode: "production",
        versionId: "v1",
      };

      const result = runWithCacheKeyContext(ctx, tryGetCacheKeyContext);

      assertEquals(result?.projectId, "test");
    });
  });

  describe("getProjectScopedKey", () => {
    it("should return null when no context", () => {
      assertEquals(getProjectScopedKey("prefix", "resource"), null);
    });

    it("should return null for preview mode", () => {
      const ctx: CacheKeyContext = {
        projectId: "test",
        mode: "preview",
        versionId: "main",
      };

      const key = runWithCacheKeyContext(ctx, () => getProjectScopedKey("prefix", "resource"));

      assertEquals(key, null);
    });

    it("should return key for production mode", () => {
      const ctx: CacheKeyContext = {
        projectId: "test",
        mode: "production",
        versionId: "rel_123",
      };

      const key = runWithCacheKeyContext(ctx, () => getProjectScopedKey("prefix", "resource"));

      assertEquals(key, "prefix:test:production:rel_123:resource");
    });
  });

  describe("getProjectScopedKeyAlways", () => {
    it("should return key even for preview mode", () => {
      const ctx: CacheKeyContext = {
        projectId: "test",
        mode: "preview",
        versionId: "main",
      };

      const key = runWithCacheKeyContext(
        ctx,
        () => getProjectScopedKeyAlways("prefix", "resource"),
      );

      assertEquals(key, "prefix:test:preview:main:resource");
    });
  });
});
