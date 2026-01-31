import { describe, it } from "@veryfront/testing/bdd";
import { assertEquals, assertMatch, assertThrows } from "@veryfront/testing/assert";
import {
  buildConfigCacheKey,
  buildRenderCacheKey,
  buildRenderCachePrefix,
  CacheKeyPrefix,
  computeContentSourceId,
  parseRenderCacheKey,
} from "./keys.ts";

describe("cache/keys", () => {
  describe("CacheKeyPrefix", () => {
    it("should have SSR_MODULE prefix", () => {
      assertEquals(CacheKeyPrefix.SSR_MODULE, "veryfront:ssr-module:");
    });

    it("should have CONFIG prefix", () => {
      assertEquals(CacheKeyPrefix.CONFIG, "config");
    });

    it("should have FILE prefix", () => {
      assertEquals(CacheKeyPrefix.FILE, "file");
    });
  });

  describe("buildRenderCachePrefix", () => {
    it("should build prefix for production", () => {
      const prefix = buildRenderCachePrefix("proj_123", "production", "rel_456");
      assertMatch(prefix, /^proj_123:production:rel_456:.+$/);
    });

    it("should build prefix for preview", () => {
      const prefix = buildRenderCachePrefix("proj_123", "preview", "main");
      assertMatch(prefix, /^proj_123:preview:main:.+$/);
    });
  });

  describe("buildRenderCacheKey", () => {
    it("should append content key to prefix", () => {
      assertEquals(
        buildRenderCacheKey("prefix:here", "page:blog/post"),
        "prefix:here:page:blog/post",
      );
    });
  });

  describe("parseRenderCacheKey", () => {
    it("should parse valid cache key", () => {
      assertEquals(parseRenderCacheKey("proj:production:rel:1.0.0:page:content"), {
        projectId: "proj",
        environment: "production",
        releaseKey: "rel",
        version: "1.0.0",
        contentKey: "page:content",
      });
    });

    it("should return null for invalid key (too few parts)", () => {
      assertEquals(parseRenderCacheKey("proj:production:rel"), null);
    });

    it("should handle content key with colons", () => {
      assertEquals(parseRenderCacheKey("proj:prod:rel:1.0:a:b:c")?.contentKey, "a:b:c");
    });
  });

  describe("buildConfigCacheKey", () => {
    it("should build key for virtual filesystem", () => {
      assertMatch(buildConfigCacheKey("codersociety", true), /^vf:codersociety:.+$/);
    });

    it("should build key for local filesystem", () => {
      assertMatch(buildConfigCacheKey("/path/to/project", false), /^\/path\/to\/project:.+$/);
    });
  });

  describe("computeContentSourceId", () => {
    it("should return local-{branch} for local dev", () => {
      assertEquals(computeContentSourceId(true, "preview", "feature-x", null), "local-feature-x");
    });

    it("should return local-main for local dev with null branch", () => {
      assertEquals(computeContentSourceId(true, "preview", null, null), "local-main");
    });

    it("should return local-{branch} for local dev even in production environment", () => {
      assertEquals(computeContentSourceId(true, "production", "main", "rel_123"), "local-main");
    });

    it("should return preview-{branch} for remote preview", () => {
      assertEquals(
        computeContentSourceId(false, "preview", "feature-branch", null),
        "preview-feature-branch",
      );
    });

    it("should return preview-main for remote preview with null branch", () => {
      assertEquals(computeContentSourceId(false, "preview", null, null), "preview-main");
    });

    it("should return release-{releaseId} for remote production", () => {
      assertEquals(
        computeContentSourceId(false, "production", "main", "rel_abc123"),
        "release-rel_abc123",
      );
    });

    it("should throw for remote production without releaseId", () => {
      assertThrows(
        () => computeContentSourceId(false, "production", "main", null),
        Error,
        "Missing releaseId for production contentSourceId",
      );
    });

    it("should throw for remote production with undefined releaseId", () => {
      assertThrows(
        () => computeContentSourceId(false, "production", "main", undefined),
        Error,
        "Missing releaseId for production contentSourceId",
      );
    });
  });
});
