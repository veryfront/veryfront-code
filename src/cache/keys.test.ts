import { describe, it } from "@veryfront/testing/bdd";
import { assertEquals, assertMatch } from "@veryfront/testing/assert";
import {
  buildConfigCacheKey,
  buildRenderCacheKey,
  buildRenderCachePrefix,
  CacheKeyPrefix,
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
      const key = buildRenderCacheKey("prefix:here", "page:blog/post");
      assertEquals(key, "prefix:here:page:blog/post");
    });
  });

  describe("parseRenderCacheKey", () => {
    it("should parse valid cache key", () => {
      const result = parseRenderCacheKey("proj:production:rel:1.0.0:page:content");
      assertEquals(result, {
        projectId: "proj",
        environment: "production",
        releaseKey: "rel",
        version: "1.0.0",
        contentKey: "page:content",
      });
    });

    it("should return null for invalid key (too few parts)", () => {
      const result = parseRenderCacheKey("proj:production:rel");
      assertEquals(result, null);
    });

    it("should handle content key with colons", () => {
      const result = parseRenderCacheKey("proj:prod:rel:1.0:a:b:c");
      assertEquals(result?.contentKey, "a:b:c");
    });
  });

  describe("buildConfigCacheKey", () => {
    it("should build key for virtual filesystem", () => {
      const key = buildConfigCacheKey("codersociety", true);
      assertMatch(key, /^vf:codersociety:.+$/);
    });

    it("should build key for local filesystem", () => {
      const key = buildConfigCacheKey("/path/to/project", false);
      assertMatch(key, /^\/path\/to\/project:.+$/);
    });
  });
});
