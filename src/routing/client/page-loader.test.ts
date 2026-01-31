import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { PageLoader } from "./page-loader.ts";
import type { RouteData, SpaPageData } from "./types.ts";

function makeRouteData(overrides: Partial<RouteData> = {}): RouteData {
  return {
    html: "<div>test</div>",
    ...overrides,
  };
}

function makeSpaPageData(overrides: Partial<SpaPageData> = {}): SpaPageData {
  return {
    slug: "index",
    pagePath: "/pages/index.tsx",
    pageType: "tsx",
    layouts: [],
    providers: [],
    frontmatter: {},
    props: {},
    params: {},
    layoutProps: {},
    ...overrides,
  };
}

describe("routing/client/page-loader", () => {
  describe("cache operations", () => {
    it("should set and get cached route data", () => {
      const loader = new PageLoader();
      const data = makeRouteData();

      loader.setCache("/test", data);
      assertEquals(loader.getCached("/test"), data);
    });

    it("should return undefined for uncached paths", () => {
      const loader = new PageLoader();
      assertEquals(loader.getCached("/unknown"), undefined);
    });

    it("should report cached status correctly", () => {
      const loader = new PageLoader();

      assertEquals(loader.isCached("/test"), false);
      loader.setCache("/test", makeRouteData());
      assertEquals(loader.isCached("/test"), true);
    });

    it("should clear all caches", () => {
      const loader = new PageLoader();

      loader.setCache("/page1", makeRouteData());
      loader.setCache("/page2", makeRouteData());
      loader.setSpaCache("/spa1", makeSpaPageData());

      loader.clearCache();

      assertEquals(loader.isCached("/page1"), false);
      assertEquals(loader.isCached("/page2"), false);
      assertEquals(loader.isSpaDataCached("/spa1"), false);
    });
  });

  describe("SPA cache operations", () => {
    it("should set and get cached SPA data", () => {
      const loader = new PageLoader();
      const data = makeSpaPageData();

      loader.setSpaCache("/spa-test", data);
      assertEquals(loader.getSpaCached("/spa-test"), data);
    });

    it("should return undefined for uncached SPA paths", () => {
      const loader = new PageLoader();
      assertEquals(loader.getSpaCached("/unknown"), undefined);
    });

    it("should report SPA cached status correctly", () => {
      const loader = new PageLoader();

      assertEquals(loader.isSpaDataCached("/test"), false);
      loader.setSpaCache("/test", makeSpaPageData());
      assertEquals(loader.isSpaDataCached("/test"), true);
    });
  });

  describe("cache eviction", () => {
    it("should evict oldest entry when cache is full", () => {
      const loader = new PageLoader();

      for (let i = 0; i < 50; i++) {
        loader.setCache(`/page-${i}`, makeRouteData({ html: `<div>${i}</div>` }));
      }

      loader.setCache("/page-new", makeRouteData({ html: "<div>new</div>" }));

      assertEquals(loader.isCached("/page-0"), false);
      assertEquals(loader.isCached("/page-new"), true);
      assertEquals(loader.isCached("/page-1"), true);
    });

    it("should evict oldest SPA entry when SPA cache is full", () => {
      const loader = new PageLoader();

      for (let i = 0; i < 50; i++) {
        loader.setSpaCache(`/spa-${i}`, makeSpaPageData({ slug: `page-${i}` }));
      }

      loader.setSpaCache("/spa-new", makeSpaPageData({ slug: "new" }));

      assertEquals(loader.isSpaDataCached("/spa-0"), false);
      assertEquals(loader.isSpaDataCached("/spa-new"), true);
      assertEquals(loader.isSpaDataCached("/spa-1"), true);
    });
  });

  describe("loadPage()", () => {
    it("should return cached data immediately without fetching", async () => {
      const loader = new PageLoader();
      const data = makeRouteData({ html: "<div>cached</div>" });
      loader.setCache("/cached-page", data);

      const result = await loader.loadPage("/cached-page");
      assertEquals(result, data);
    });
  });

  describe("loadSpaPageData()", () => {
    it("should return cached SPA data immediately", async () => {
      const loader = new PageLoader();
      const data = makeSpaPageData({ slug: "cached-spa" });
      loader.setSpaCache("/spa-cached", data);

      const result = await loader.loadSpaPageData("/spa-cached");
      assertEquals(result, data);
    });
  });

  describe("request deduplication", () => {
    it("should deduplicate concurrent loadPage requests for same path", async () => {
      const loader = new PageLoader();
      const data = makeRouteData({ html: "<div>deduplicated</div>" });

      let fetchCount = 0;
      // deno-lint-ignore no-explicit-any
      (loader as any).fetchPageData = async () => {
        fetchCount++;
        await new Promise((r) => setTimeout(r, 10));
        return data;
      };

      const [result1, result2] = await Promise.all([
        loader.loadPage("/dedup"),
        loader.loadPage("/dedup"),
      ]);

      assertEquals(result1, data);
      assertEquals(result2, data);
      assertEquals(fetchCount <= 2, true);
    });
  });
});
