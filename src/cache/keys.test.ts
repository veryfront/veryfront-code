import "#veryfront/schemas/_test-setup.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd";
import {
  assertEquals,
  assertMatch,
  assertNotEquals,
  assertThrows,
} from "#veryfront/testing/assert";
import {
  buildConfigCacheKey,
  buildGitHubContentCacheKey,
  buildModuleResolveCacheKey,
  buildModuleTransformCacheKey,
  buildProxyManagerCacheKey,
  buildQueryAwareCacheKey,
  buildRenderCacheKey,
  buildRenderCachePrefix,
  buildSSRModuleCacheKey,
  buildSSRModuleProjectKey,
  CacheKeyPrefix,
  computeContentSourceId,
  createCacheKeyFilter,
  DEFAULT_EXCLUDED_QUERY_PARAMS,
  filterQueryParams,
  isModuleResolveCacheKeyForSpecifier,
  parseModuleResolveCacheKey,
  parseRenderCacheKey,
  sanitizeQueryParamsForCacheKey,
} from "./keys.ts";
import { hashPathWithName } from "./keys/utils.ts";
import {
  clearReleaseAssetManifestCache,
  configureReleaseAssetManifestFetcher,
  getReadyManifestForRender,
} from "#veryfront/release-assets/manifest-cache.ts";
import type { ReleaseAssetManifest } from "#veryfront/release-assets/manifest-schema.ts";

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

    it("is immutable at runtime", () => {
      assertEquals(Object.isFrozen(CacheKeyPrefix), true);
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

    it("should append :m{n} suffix when manifestVersion is provided", () => {
      const base = buildRenderCachePrefix("proj_123", "production", "rel_456");
      const withManifest = buildRenderCachePrefix("proj_123", "production", "rel_456", 1);
      assertMatch(withManifest, /^proj_123:production:rel_456:.+:m1$/);
      assertNotEquals(base, withManifest);
    });

    it("should produce identical prefix when manifestVersion is undefined (flag-off byte-identical)", () => {
      const withUndefined = buildRenderCachePrefix("proj_123", "production", "rel_456", undefined);
      const withoutArg = buildRenderCachePrefix("proj_123", "production", "rel_456");
      assertEquals(withUndefined, withoutArg);
    });

    it("encodes delimiter-bearing render identities without losing parseability", () => {
      const prefix = buildRenderCachePrefix("tenant:blue", "production", "release:42");
      const parsed = parseRenderCacheKey(`${prefix}:page:index`);

      assertEquals(prefix.includes("tenant%3Ablue:production:release%3A42:"), true);
      assertEquals(parsed?.projectId, "tenant:blue");
      assertEquals(parsed?.releaseKey, "release:42");
    });
  });

  describe("render cache prefix + manifest consumption", () => {
    const makeManifest = (): ReleaseAssetManifest => ({
      schemaVersion: 1,
      manifestVersion: 1,
      projectId: "proj_123",
      releaseId: "rel_456",
      releaseVersion: 1,
      builderVersion: "0.1.765",
      sourceContentHash: "abc123",
      createdAt: "2026-06-12T00:00:00Z",
      assetBasePath: "/_vf/assets",
      modules: {},
      css: [],
      routes: {},
      fallback: { mode: "jit" as const, gaps: [] },
      dependencies: {},
    });

    afterEach(() => {
      clearReleaseAssetManifestCache();
      configureReleaseAssetManifestFetcher(undefined);
      try {
        Deno.env.delete("VERYFRONT_RELEASE_ASSET_MANIFEST");
      } catch (_) { /* env may be read-only in some test configs */ }
    });

    it("flag off: getReadyManifestForRender returns null even when fetcher is registered", () => {
      try {
        Deno.env.delete("VERYFRONT_RELEASE_ASSET_MANIFEST");
      } catch (_) { /* ok */ }
      configureReleaseAssetManifestFetcher(async () => ({
        state: "ready",
        manifest: makeManifest(),
      }));
      // With flag off, must return null
      assertEquals(getReadyManifestForRender("rel_456"), null);

      // Cache prefix is byte-identical whether manifestVersion is undefined or not passed
      const prefixNoManifest = buildRenderCachePrefix("proj_123", "production", "rel_456");
      const prefixWithUndefined = buildRenderCachePrefix(
        "proj_123",
        "production",
        "rel_456",
        undefined,
      );
      assertEquals(prefixNoManifest, prefixWithUndefined);
    });

    it("flag on + ready manifest: cache prefix gains :m{manifestVersion} suffix", async () => {
      Deno.env.set("VERYFRONT_RELEASE_ASSET_MANIFEST", "1");

      let resolvePromise!: () => void;
      const fetchDone = new Promise<void>((r) => {
        resolvePromise = r;
      });
      configureReleaseAssetManifestFetcher(async () => {
        resolvePromise();
        return { state: "ready", manifest: makeManifest() };
      });

      // First call: cache miss → background fetch scheduled → returns null
      assertEquals(getReadyManifestForRender("rel_456"), null);

      // Wait for the background fetch to complete
      await fetchDone;
      await Promise.resolve();

      // Second call: cache hit → returns manifest
      const cached = getReadyManifestForRender("rel_456");
      assertEquals(cached?.manifestVersion, 1);

      // Prefixes must differ
      const prefixJIT = buildRenderCachePrefix("proj_123", "production", "rel_456");
      const prefixManifest = buildRenderCachePrefix(
        "proj_123",
        "production",
        "rel_456",
        cached?.manifestVersion,
      );
      assertNotEquals(prefixJIT, prefixManifest);
      assertMatch(prefixManifest, /:m1$/);
    });

    it("flag on + no ready manifest: prefix is identical to JIT prefix", () => {
      Deno.env.set("VERYFRONT_RELEASE_ASSET_MANIFEST", "1");
      // No fetcher registered → getReadyManifestForRender returns null
      const manifest = getReadyManifestForRender("rel_456");
      assertEquals(manifest, null);

      const prefixJIT = buildRenderCachePrefix("proj_123", "production", "rel_456");
      const prefixWithNull = buildRenderCachePrefix(
        "proj_123",
        "production",
        "rel_456",
        manifest?.manifestVersion,
      );
      assertEquals(prefixJIT, prefixWithNull);
    });
  });

  describe("buildRenderCacheKey", () => {
    it("should append content key to prefix", () => {
      assertEquals(
        buildRenderCacheKey("prefix:here", "page:blog/post"),
        "prefix:here:page:blog/post",
      );
    });

    it("does not let content impersonate a manifest-version prefix", () => {
      const basePrefix = buildRenderCachePrefix("project", "production", "release");
      const manifestPrefix = buildRenderCachePrefix("project", "production", "release", 1);

      assertNotEquals(
        buildRenderCacheKey(basePrefix, "m1:/home"),
        buildRenderCacheKey(manifestPrefix, "/home"),
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

  describe("createCacheKeyFilter", () => {
    it("does not match a project identity in an unrelated deep segment", () => {
      const filter = createCacheKeyFilter({ projectId: "project123" });

      assertEquals(filter("unrelated:a:b:project123"), false);
      assertEquals(filter("layout:project123:release-1:component"), true);
    });
  });

  describe("buildConfigCacheKey", () => {
    it("should build key for virtual filesystem", () => {
      assertMatch(buildConfigCacheKey("example-project", true), /^vf:example-project:.+$/);
    });

    it("separates virtual config caches by exact source target", () => {
      const main = buildConfigCacheKey("example-project", true, {
        productionMode: false,
        branch: "main",
      });
      const preview = buildConfigCacheKey("example-project", true, {
        productionMode: false,
        branch: "feature/integrations",
      });
      const release = buildConfigCacheKey("example-project", true, {
        productionMode: true,
        releaseId: "release-1",
      });
      const environment = buildConfigCacheKey("example-project", true, {
        productionMode: true,
        releaseId: "release-1",
        environmentName: "Production",
      });

      assertNotEquals(main, preview);
      assertNotEquals(main, release);
      assertNotEquals(release, environment);
      assertEquals(
        main.includes("source:branch:main"),
        true,
      );
      assertEquals(
        preview.includes("source:branch:feature%2Fintegrations"),
        true,
      );
      assertEquals(
        release.includes("source:release:release-1"),
        true,
      );
      assertEquals(
        environment.includes("source:environment:Production:release-1"),
        true,
      );
    });

    it("uses injective structured encoding for environment config sources", () => {
      const left = buildConfigCacheKey("example-project", true, {
        productionMode: true,
        environmentName: "Production:release-1",
        releaseId: "release-2",
      });
      const right = buildConfigCacheKey("example-project", true, {
        productionMode: true,
        environmentName: "Production",
        releaseId: "release-1:release-2",
      });

      assertNotEquals(left, right);
    });

    it("does not let a project identity impersonate source-key structure", () => {
      const identityContainingSource = buildConfigCacheKey(
        "tenant:source:branch:main",
        true,
      );
      const tenantWithSource = buildConfigCacheKey("tenant", true, {
        productionMode: false,
        branch: "main",
      });

      assertNotEquals(identityContainingSource, tenantWithSource);
    });

    it("should build key for local filesystem", () => {
      // Should use hashed path with folder name, not absolute path
      // Format: config:local-{hash}-{folderName}:{version}
      assertMatch(
        buildConfigCacheKey("/path/to/project", false),
        /^config:local-[a-f0-9]+-project:.+$/,
      );
    });

    it("does not collapse distinct malformed path identities", () => {
      assertNotEquals(
        hashPathWithName("/workspace/\ud800/project"),
        hashPathWithName("/workspace/\ud801/project"),
      );
    });
  });

  describe("buildProxyManagerCacheKey", () => {
    it("requires an immutable release for production environments", () => {
      assertThrows(
        () => buildProxyManagerCacheKey("example-project", true, null, null, "Production"),
        Error,
        "Missing releaseId for production proxy cache identity",
      );
    });

    it("separates production environment and release identities", () => {
      const environment = buildProxyManagerCacheKey(
        "example-project",
        true,
        "release-1",
        null,
        "Production",
      );
      const release = buildProxyManagerCacheKey(
        "example-project",
        true,
        "release-1",
        null,
      );

      assertNotEquals(environment, release);
      assertEquals(environment.includes("environment:Production:release-1"), true);
      assertEquals(release.includes("release:release-1"), true);
    });

    it("encodes delimiter-bearing project slugs as one key segment", () => {
      const key = buildProxyManagerCacheKey(
        "tenant:preview",
        false,
        null,
        "main",
      );

      assertEquals(key.startsWith("proxy:tenant%3Apreview:preview:"), true);
      assertEquals(key.includes("proxy:tenant:preview:preview:"), false);
    });
  });

  describe("module and adapter key isolation", () => {
    it("keeps module resolver field boundaries injective", () => {
      assertNotEquals(
        buildModuleResolveCacheKey("package:subpath", "referrer"),
        buildModuleResolveCacheKey("package", "subpath:referrer"),
      );
      assertNotEquals(
        buildModuleResolveCacheKey("package"),
        buildModuleResolveCacheKey("package", "root"),
      );
    });

    it("parses canonical module resolver identities for exact invalidation", () => {
      const key = buildModuleResolveCacheKey("virtual:part/one", "pages:home.tsx");

      assertEquals(parseModuleResolveCacheKey(key), {
        specifier: "virtual:part/one",
        referrer: "pages:home.tsx",
      });
      assertEquals(isModuleResolveCacheKeyForSpecifier(key, "virtual:part/one"), true);
      assertEquals(isModuleResolveCacheKeyForSpecifier(key, "virtual:part"), false);
      assertEquals(parseModuleResolveCacheKey("resolve:virtual%3apart%2fone:root"), null);
    });

    it("parses every bounded identity emitted by the module resolver key builder", () => {
      const boundedIdentity = "\uffff".repeat(4096);
      const key = buildModuleResolveCacheKey(boundedIdentity, boundedIdentity);

      assertEquals(parseModuleResolveCacheKey(key), {
        specifier: boundedIdentity,
        referrer: boundedIdentity,
      });
    });

    it("keeps module transform and project field boundaries injective", () => {
      assertNotEquals(
        buildSSRModuleProjectKey("/workspace:tenant", "project"),
        buildSSRModuleProjectKey("/workspace", "tenant:project"),
      );
      assertNotEquals(
        buildModuleTransformCacheKey("tenant:project", "module.ts", true),
        buildModuleTransformCacheKey("tenant", "project:module.ts", true),
      );
      assertNotEquals(
        buildSSRModuleCacheKey(1, "tenant:project", "module.ts"),
        buildSSRModuleCacheKey(1, "tenant", "project:module.ts"),
      );
    });

    it("keeps GitHub adapter field boundaries injective", () => {
      assertNotEquals(
        buildGitHubContentCacheKey("release:one", "pages/index.ts"),
        buildGitHubContentCacheKey("release", "one:pages/index.ts"),
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

    it("should exclude tracking and cache-busting params case-insensitively", () => {
      const params = new URLSearchParams(
        "page=1&UTM_SOURCE=google&GAD_SOURCE=ad&CACHEBUST=123&_=456",
      );
      const result = filterQueryParams(params);
      assertEquals(result, [["page", "1"]]);
    });

    it("rejects unsupported policies instead of silently changing cache semantics", () => {
      assertThrows(
        () =>
          filterQueryParams(
            new URLSearchParams("a=1"),
            { policy: "unsupported" } as never,
          ),
        Error,
        "Query parameter cache policy is invalid",
      );
    });

    it("rejects malformed or unreadable options", () => {
      assertThrows(
        () => filterQueryParams(new URLSearchParams("a=1"), { params: "a" } as never),
        Error,
        "Query parameter cache options are invalid",
      );
      assertThrows(
        () =>
          filterQueryParams(
            new URLSearchParams("a=1"),
            new Proxy({}, {
              get: () => {
                throw new Error("secret getter failure");
              },
            }) as never,
          ),
        Error,
        "Query parameter cache options are unreadable",
      );
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

    it("should encode values with special characters without collisions", () => {
      const url = new URL("https://example.com/page?url=https://example.com");
      const result = sanitizeQueryParamsForCacheKey(url);
      assertEquals(result, "url-https*3A*2F*2Fexample.com");
    });

    it("should keep distinct query values with different special characters", () => {
      const left = sanitizeQueryParamsForCacheKey(new URL("https://example.com/page?q=a/b"));
      const right = sanitizeQueryParamsForCacheKey(new URL("https://example.com/page?q=a:b"));
      assertNotEquals(left, right);
    });

    it("keeps query field boundaries distinct when data contains separators", () => {
      const delimiterInName = sanitizeQueryParamsForCacheKey(
        new URL("https://example.com/page?a-b=c"),
      );
      const delimiterInValue = sanitizeQueryParamsForCacheKey(
        new URL("https://example.com/page?a=b-c"),
      );
      const entryDelimiterInValue = sanitizeQueryParamsForCacheKey(
        new URL("https://example.com/page?a=b_c-d"),
      );
      const twoEntries = sanitizeQueryParamsForCacheKey(
        new URL("https://example.com/page?a=b&c=d"),
      );

      assertNotEquals(delimiterInName, delimiterInValue);
      assertNotEquals(entryDelimiterInValue, twoEntries);
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

    it("should preserve repeated query param value order while sorting keys", () => {
      const url = new URL("https://example.com/page?tag=b&tag=a&page=2");
      const result = sanitizeQueryParamsForCacheKey(url);
      assertEquals(result, "page-2_tag-b_tag-a");
    });

    it("should keep different repeated query param orders distinct", () => {
      const left = sanitizeQueryParamsForCacheKey(
        new URL("https://example.com/page?sort=price&sort=rating"),
      );
      const right = sanitizeQueryParamsForCacheKey(
        new URL("https://example.com/page?sort=rating&sort=price"),
      );
      assertNotEquals(left, right);
    });

    it("sorts non-ASCII parameter names by code point for portable keys", () => {
      const url = new URL("https://example.com/page?%C3%A4=1&z=2");

      assertEquals(sanitizeQueryParamsForCacheKey(url), "z-2_*C3*A4-1");
    });
  });

  describe("buildQueryAwareCacheKey", () => {
    it("should return slug when no URL provided", () => {
      assertEquals(buildQueryAwareCacheKey("/blog"), "/blog");
    });

    it("should normalize the root slug to a non-empty key", () => {
      assertEquals(buildQueryAwareCacheKey(""), "index");
      assertEquals(buildQueryAwareCacheKey("", new URL("https://example.com/")), "index");
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

    it("keeps literal query separators in slugs distinct from query keys", () => {
      const literalSlug = buildQueryAwareCacheKey("/blog:q:page-2");
      const queryKey = buildQueryAwareCacheKey(
        "/blog",
        new URL("https://example.com/blog?page=2"),
      );

      assertNotEquals(literalSlug, queryKey);
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

    it("should return just slug when all params are cache-busting params", () => {
      const url = new URL("https://example.com/blog?cb=123&cacheBust=456&cache_buster=789");
      const result = buildQueryAwareCacheKey("/blog", url);
      assertEquals(result, "/blog");
    });
  });

  describe("DEFAULT_EXCLUDED_QUERY_PARAMS", () => {
    it("is immutable at runtime", () => {
      assertEquals(Object.isFrozen(DEFAULT_EXCLUDED_QUERY_PARAMS), true);
    });

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
