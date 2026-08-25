import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { PageDataPayload } from "./env.ts";
import {
  appendDependencyPinningVersion,
  appendQueryParam,
  assertPageDataMatchesDocumentSnapshot,
  buildPageDataEndpoint,
  buildPinnedRscModuleUrl,
  componentCacheKey,
  normalizeReleaseAssetModulePath,
  pageDataCacheIdentity,
} from "./module-urls.ts";

describe("hydration-script-builder/runtime/module-urls", () => {
  describe("appendQueryParam", () => {
    it("starts a query string when the url has none", () => {
      assertEquals(
        appendQueryParam("/_vf_modules/pages/blog.js", "t", "123"),
        "/_vf_modules/pages/blog.js?t=123",
      );
    });

    it("extends an existing query string", () => {
      assertEquals(
        appendQueryParam("/_vf_modules/pages/blog.js?vf_release=rel-1", "t", "123"),
        "/_vf_modules/pages/blog.js?vf_release=rel-1&t=123",
      );
    });
  });

  describe("appendDependencyPinningVersion", () => {
    it("replaces stale path tokens while preserving release, HMR, and hash state", () => {
      assertEquals(
        appendDependencyPinningVersion(
          "/_vf_modules/_pins/on%3Astale/pages/blog.js?vf_release=rel-1&t=123&pins=on%3Astale#entry",
          { dependencyPinningCacheKey: "on:sha-a" },
        ),
        "/_vf_modules/_pins/on%3Asha-a/pages/blog.js?vf_release=rel-1&t=123#entry",
      );
      assertEquals(
        appendDependencyPinningVersion(
          "/_vf_modules/_pins/project-dir/blog.js",
          { dependencyPinningCacheKey: "on:sha-a" },
        ),
        "/_vf_modules/_pins/on%3Asha-a/_pins/project-dir/blog.js",
      );
    });

    it("pins absolute module-server urls on the path, not the query", () => {
      assertEquals(
        appendDependencyPinningVersion(
          "https://site.example/_vf_modules/pages/blog.js?t=1",
          { dependencyPinningCacheKey: "on:sha-a" },
        ),
        "https://site.example/_vf_modules/_pins/on%3Asha-a/pages/blog.js?t=1",
        "an absolute module-server url must be pinned via the _pins path segment",
      );
      assertEquals(
        appendDependencyPinningVersion(
          "/proxy/_vf_modules/pages/blog.js",
          { dependencyPinningCacheKey: "on:sha-a" },
        ),
        "/proxy/_vf_modules/pages/blog.js?pins=on%3Asha-a",
        "a non-origin prefix must fall back to the pins query parameter",
      );
    });

    it("pins non-module-server urls with a query parameter", () => {
      assertEquals(
        appendDependencyPinningVersion(
          "/_veryfront/rsc/module?rel=app%2Fpage.tsx",
          { dependencyPinningCacheKey: "on:sha-a" },
        ),
        "/_veryfront/rsc/module?rel=app%2Fpage.tsx&pins=on%3Asha-a",
      );
    });

    it("leaves the url alone when pinning is off or absent", () => {
      assertEquals(
        appendDependencyPinningVersion("/_vf_modules/pages/blog.js", {
          dependencyPinningCacheKey: "off",
        }),
        "/_vf_modules/pages/blog.js",
      );
      assertEquals(
        appendDependencyPinningVersion("/_vf_modules/pages/blog.js", undefined),
        "/_vf_modules/pages/blog.js",
      );
      assertEquals(
        appendDependencyPinningVersion("/_vf_modules/pages/blog.js", null),
        "/_vf_modules/pages/blog.js",
      );
    });
  });

  describe("componentCacheKey", () => {
    it("separates components loaded under different snapshots", () => {
      assertEquals(
        componentCacheKey("app/layout.tsx", { dependencyPinningCacheKey: "on:sha-a" }),
        "app/layout.tsx|vf_pins|on:sha-a",
      );
    });

    it("uses the bare path when pinning is off", () => {
      assertEquals(
        componentCacheKey("app/layout.tsx", { dependencyPinningCacheKey: "off" }),
        "app/layout.tsx",
      );
      assertEquals(componentCacheKey("app/layout.tsx", null), "app/layout.tsx");
    });
  });

  describe("normalizeReleaseAssetModulePath", () => {
    it("strips the module server prefix, leading slashes, and any query or hash", () => {
      assertEquals(normalizeReleaseAssetModulePath("/_vf_modules/pages/blog.js"), "pages/blog.js");
      assertEquals(normalizeReleaseAssetModulePath("_vf_modules/pages/blog.js"), "pages/blog.js");
      assertEquals(normalizeReleaseAssetModulePath("//pages/blog.js"), "pages/blog.js");
      assertEquals(normalizeReleaseAssetModulePath("pages/blog.js?t=123#entry"), "pages/blog.js");
    });

    it("returns an empty string for a missing path", () => {
      assertEquals(normalizeReleaseAssetModulePath(undefined), "");
      assertEquals(normalizeReleaseAssetModulePath(null), "");
    });
  });

  describe("buildPinnedRscModuleUrl", () => {
    it("encodes the module path", () => {
      assertEquals(
        buildPinnedRscModuleUrl("app/page.tsx", null),
        "/_veryfront/rsc/module?rel=app%2Fpage.tsx",
      );
    });

    it("appends the snapshot pin when the document is pinned", () => {
      assertEquals(
        buildPinnedRscModuleUrl("app/page.tsx", { dependencyPinningCacheKey: "on:snapshot-a" }),
        "/_veryfront/rsc/module?rel=app%2Fpage.tsx&pins=on%3Asnapshot-a",
      );
    });
  });

  describe("buildPageDataEndpoint", () => {
    const origin = "https://veryfront.test";

    // Empty, not "index": the endpoint handler turns this URL into slug "",
    // which is the same value the full-page SSR path derives for "/" and the
    // form both route resolvers pin for the root page. "index" would resolve
    // app/index/page on App Router, which is not the root route.
    it("maps the root path to the empty page-data slug", () => {
      assertEquals(buildPageDataEndpoint("/", origin), "/_veryfront/page-data/.json");
    });

    it("maps a nested path to a nested page-data slug", () => {
      assertEquals(
        buildPageDataEndpoint("/docs/guides/intro", origin),
        "/_veryfront/page-data/docs/guides/intro.json",
      );
    });

    it("preserves the route query string", () => {
      assertEquals(
        buildPageDataEndpoint("/search?pins=customer-value&q=one", origin),
        "/_veryfront/page-data/search.json?pins=customer-value&q=one",
      );
    });
  });

  describe("pageDataCacheIdentity", () => {
    it("qualifies the path with the document snapshot", () => {
      assertEquals(
        pageDataCacheIdentity("/search", "on:snapshot-a"),
        "on:snapshot-a|path:/search",
      );
    });

    it("uses the bare path when the document is unpinned", () => {
      assertEquals(pageDataCacheIdentity("/search", null), "/search");
    });
  });

  describe("assertPageDataMatchesDocumentSnapshot", () => {
    it("returns the data when the document is unpinned", () => {
      const data: PageDataPayload = { pagePath: "page" };
      assertEquals(assertPageDataMatchesDocumentSnapshot("/x", data, null), data);
    });

    it("returns the data when both snapshots agree", () => {
      const data: PageDataPayload = { dependencyPinningCacheKey: "on:snapshot-a" };
      assertEquals(
        assertPageDataMatchesDocumentSnapshot("/x", data, "on:snapshot-a"),
        data,
      );
    });

    it("throws a 409 mismatch when the snapshots differ", () => {
      const data: PageDataPayload = { dependencyPinningCacheKey: "on:snapshot-b" };

      let thrown:
        | (Error & { status?: number; dependencySnapshotMismatch?: boolean; path?: string })
        | undefined;
      try {
        assertPageDataMatchesDocumentSnapshot("/x", data, "on:snapshot-a");
      } catch (error) {
        thrown = error as typeof thrown;
      }

      assertEquals(thrown?.status, 409);
      assertEquals(thrown?.dependencySnapshotMismatch, true);
      assertEquals(thrown?.path, "/x");
    });
  });
});
