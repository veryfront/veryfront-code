import { describe, it } from "#veryfront/testing/bdd";
import { assertEquals, assertMatch, assertThrows } from "#veryfront/testing/assert";
import {
  buildConfigCacheKey,
  buildQueryAwareCacheKey,
  buildRenderCacheKey,
  buildRenderCachePrefix,
  CacheKeyPrefix,
  computeContentSourceId,
  DEFAULT_EXCLUDED_QUERY_PARAMS,
  filterQueryParams,
  parseRenderCacheKey,
  sanitizeQueryParamsForCacheKey,
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
      assertMatch(buildConfigCacheKey("example-project", true), /^vf:example-project:.+$/);
    });

    it("should build key for local filesystem", () => {
      // Should use hashed path with folder name, not absolute path
      // Format: config:local-{hash}-{folderName}:{version}
      assertMatch(
        buildConfigCacheKey("/path/to/project", false),
        /^config:local-[a-f0-9]+-project:.+$/,
      );
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

  describe("filterQueryParams", () => {
    it("should exclude tracking params by default (exclude-list policy)", () => {
      const params = new URLSearchParams("page=1&utm_source=google&_hsenc=test");
      const result = filterQueryParams(params);
      assertEquals(result, [["page", "1"]]);
    });

    it("should return all params for explicit include-all policy", () => {
      const params = new URLSearchParams("a=1&b=2");
      const result = filterQueryParams(params, { policy: "include-all" });
      assertEquals(result, [["a", "1"], ["b", "2"]]);
    });

    it("should return empty array for ignore-all policy", () => {
      const params = new URLSearchParams("a=1&b=2");
      const result = filterQueryParams(params, { policy: "ignore-all" });
      assertEquals(result, []);
    });

    it("should filter to only included params for include-list policy", () => {
      const params = new URLSearchParams("a=1&b=2&c=3");
      const result = filterQueryParams(params, { policy: "include-list", params: ["a", "c"] });
      assertEquals(result, [["a", "1"], ["c", "3"]]);
    });

    it("should exclude specified params plus defaults for exclude-list policy", () => {
      const params = new URLSearchParams("page=1&utm_source=google&custom=val");
      const result = filterQueryParams(params, { policy: "exclude-list", params: ["custom"] });
      assertEquals(result, [["page", "1"]]);
    });

    it("should exclude default tracking params when using exclude-list", () => {
      const params = new URLSearchParams("page=1&utm_campaign=test&gclid=abc&fbclid=xyz");
      const result = filterQueryParams(params, { policy: "exclude-list" });
      assertEquals(result, [["page", "1"]]);
    });
  });

  describe("sanitizeQueryParamsForCacheKey", () => {
    it("should return empty string when no query params", () => {
      const url = new URL("https://example.com/page");
      assertEquals(sanitizeQueryParamsForCacheKey(url), "");
    });

    it("should sanitize special characters in params", () => {
      const url = new URL("https://example.com/page?foo=bar&baz=qux");
      const result = sanitizeQueryParamsForCacheKey(url);
      // Should use hyphens instead of equals, underscores instead of ampersands
      assertEquals(result, "baz-qux_foo-bar");
    });

    it("should sanitize values with special characters", () => {
      const url = new URL("https://example.com/page?url=https://example.com");
      const result = sanitizeQueryParamsForCacheKey(url);
      // Special chars in values should be replaced with underscores
      // Note: dots (.) are allowed, so example.com stays as-is
      assertEquals(result, "url-https___example.com");
    });

    it("should respect ignore-all policy", () => {
      const url = new URL("https://example.com/page?a=1&b=2");
      const result = sanitizeQueryParamsForCacheKey(url, { policy: "ignore-all" });
      assertEquals(result, "");
    });

    it("should respect exclude-list policy", () => {
      const url = new URL("https://example.com/page?page=1&utm_source=google");
      const result = sanitizeQueryParamsForCacheKey(url, { policy: "exclude-list" });
      assertEquals(result, "page-1");
    });
  });

  describe("buildQueryAwareCacheKey", () => {
    it("should return slug when no URL provided", () => {
      assertEquals(buildQueryAwareCacheKey("/blog"), "/blog");
    });

    it("should return slug when URL has no query params", () => {
      const url = new URL("https://example.com/blog");
      assertEquals(buildQueryAwareCacheKey("/blog", url), "/blog");
    });

    it("should append sanitized query params with :q: prefix", () => {
      const url = new URL("https://example.com/blog?page=2&sort=desc");
      const result = buildQueryAwareCacheKey("/blog", url);
      assertEquals(result, "/blog:q:page-2_sort-desc");
    });

    it("should ignore tracking params by default (exclude-list is default)", () => {
      const url = new URL("https://example.com/blog?page=1&utm_campaign=test");
      const result = buildQueryAwareCacheKey("/blog", url);
      assertEquals(result, "/blog:q:page-1");
    });

    it("should return just slug when all params are tracking params", () => {
      const url = new URL("https://example.com/blog?utm_source=google&utm_campaign=test");
      const result = buildQueryAwareCacheKey("/blog", url);
      assertEquals(result, "/blog");
    });
  });

  describe("DEFAULT_EXCLUDED_QUERY_PARAMS", () => {
    it("should include common UTM parameters", () => {
      assertEquals(DEFAULT_EXCLUDED_QUERY_PARAMS.includes("utm_source"), true);
      assertEquals(DEFAULT_EXCLUDED_QUERY_PARAMS.includes("utm_campaign"), true);
      assertEquals(DEFAULT_EXCLUDED_QUERY_PARAMS.includes("utm_medium"), true);
    });

    it("should include common tracking IDs", () => {
      assertEquals(DEFAULT_EXCLUDED_QUERY_PARAMS.includes("gclid"), true);
      assertEquals(DEFAULT_EXCLUDED_QUERY_PARAMS.includes("fbclid"), true);
      assertEquals(DEFAULT_EXCLUDED_QUERY_PARAMS.includes("msclkid"), true);
    });

    it("should include HubSpot tracking params", () => {
      assertEquals(DEFAULT_EXCLUDED_QUERY_PARAMS.includes("_hsenc"), true);
      assertEquals(DEFAULT_EXCLUDED_QUERY_PARAMS.includes("_hsmi"), true);
    });
  });
});
