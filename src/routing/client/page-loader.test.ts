import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
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

    it("does not evict an unrelated entry when replacing a cached path", () => {
      const loader = new PageLoader();

      for (let i = 0; i < 50; i++) {
        loader.setCache(`/page-${i}`, makeRouteData({ html: `<div>${i}</div>` }));
      }

      loader.setCache("/page-20", makeRouteData({ html: "<div>updated</div>" }));

      assertEquals(loader.isCached("/page-0"), true);
      assertEquals(loader.getCached("/page-20")?.html, "<div>updated</div>");
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

  describe("page data URL", () => {
    it("places the JSON suffix before query parameters and maps root to index", async () => {
      const originalFetch = globalThis.fetch;
      let requestedUrl = "";
      globalThis.fetch = (input: URL | RequestInfo) => {
        requestedUrl = String(input);
        return Promise.resolve(Response.json({ html: "root" }));
      };

      try {
        await new PageLoader().fetchPageData("/?page=2#section");
        assertEquals(requestedUrl, "/_veryfront/data/index.json?page=2");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("does not hide a failed or malformed data endpoint behind HTML fallback", async () => {
      for (
        const response of [
          new Response("failed", { status: 500 }),
          new Response("{broken", {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ]
      ) {
        const originalFetch = globalThis.fetch;
        let fetchCount = 0;
        globalThis.fetch = () => {
          fetchCount++;
          return Promise.resolve(response);
        };
        try {
          await assertRejects(() => new PageLoader().fetchPageData("/page"), Error);
          assertEquals(fetchCount, 1);
        } finally {
          globalThis.fetch = originalFetch;
        }
      }
    });

    it("rejects invalid or oversized response metadata before consuming the body", async () => {
      for (const contentLength of ["invalid", `${4 * 1024 * 1024 + 1}`]) {
        const originalFetch = globalThis.fetch;
        let pullCount = 0;
        let cancelCount = 0;
        const body = new ReadableStream<Uint8Array>({
          pull() {
            pullCount++;
          },
          cancel() {
            cancelCount++;
          },
        }, { highWaterMark: 0 });
        globalThis.fetch = () =>
          Promise.resolve(
            new Response(body, {
              headers: { "content-length": contentLength },
            }),
          );

        try {
          await assertRejects(
            () => new PageLoader().fetchPageData("/page"),
            Error,
            contentLength === "invalid" ? "invalid Content-Length" : "exceeds",
          );
          await Promise.resolve();
          assertEquals(pullCount, 0);
          assertEquals(cancelCount, 1);
        } finally {
          globalThis.fetch = originalFetch;
        }
      }
    });

    it("rejects external, active-content, and unbounded navigation paths", () => {
      const loader = new PageLoader();
      for (
        const path of [
          "https://example.com/page",
          "//example.com/page",
          "javascript:alert(1)",
          "a".repeat(8_193),
        ]
      ) {
        assertThrows(() => loader.loadPage(path), TypeError, "path");
      }
    });
  });

  describe("loadSpaPageData()", () => {
    it("builds a valid root page-data URL with query parameters", async () => {
      const originalFetch = globalThis.fetch;
      let requestedUrl = "";
      globalThis.fetch = (input: URL | RequestInfo) => {
        requestedUrl = String(input);
        return Promise.resolve(Response.json(makeSpaPageData()));
      };

      try {
        await new PageLoader().fetchSpaPageData("/?page=2#section");
        assertEquals(requestedUrl, "/_veryfront/page-data/index.json?page=2");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

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
      assertEquals(fetchCount, 1);
    });

    it("should deduplicate prefetch and loadPage requests for same path", async () => {
      const loader = new PageLoader();
      const data = makeRouteData({ html: "<div>prefetched</div>" });
      let resolveFetch!: (value: RouteData) => void;
      const fetchPromise = new Promise<RouteData>((resolve) => {
        resolveFetch = resolve;
      });
      let fetchCount = 0;

      // deno-lint-ignore no-explicit-any
      (loader as any).fetchPageData = () => {
        fetchCount++;
        return fetchPromise;
      };

      const prefetch = loader.prefetch("/prefetch-dedup");
      const load = loader.loadPage("/prefetch-dedup");

      resolveFetch(data);
      const result = await load;
      await prefetch;

      assertEquals(result, data);
      assertEquals(fetchCount, 1);
    });

    it("should deduplicate concurrent prefetchSpaPageData requests for same path", async () => {
      const loader = new PageLoader();
      const data = makeSpaPageData({ slug: "spa-prefetch-dedup" });
      let resolveFetch!: (value: SpaPageData) => void;
      const fetchPromise = new Promise<SpaPageData>((resolve) => {
        resolveFetch = resolve;
      });
      let fetchCount = 0;

      // deno-lint-ignore no-explicit-any
      (loader as any).fetchSpaPageData = () => {
        fetchCount++;
        return fetchPromise;
      };

      const prefetch1 = loader.prefetchSpaPageData("/spa-prefetch-dedup");
      const prefetch2 = loader.prefetchSpaPageData("/spa-prefetch-dedup");

      resolveFetch(data);
      await Promise.all([prefetch1, prefetch2]);

      assertEquals(fetchCount, 1);
      assertEquals(loader.getSpaCached("/spa-prefetch-dedup"), data);
    });

    it("should deduplicate SPA prefetch and load requests for same path", async () => {
      const loader = new PageLoader();
      const data = makeSpaPageData({ slug: "spa-load-dedup" });
      let resolveFetch!: (value: SpaPageData) => void;
      const fetchPromise = new Promise<SpaPageData>((resolve) => {
        resolveFetch = resolve;
      });
      let fetchCount = 0;

      // deno-lint-ignore no-explicit-any
      (loader as any).fetchSpaPageData = () => {
        fetchCount++;
        return fetchPromise;
      };

      const prefetch = loader.prefetchSpaPageData("/spa-load-dedup");
      const load = loader.loadSpaPageData("/spa-load-dedup");

      resolveFetch(data);
      const result = await load;
      await prefetch;

      assertEquals(result, data);
      assertEquals(fetchCount, 1);
    });

    it("does not let a cleared request repopulate cache or retire its successor", async () => {
      const loader = new PageLoader();
      const oldData = makeRouteData({ html: "<div>old</div>" });
      const newData = makeRouteData({ html: "<div>new</div>" });
      let resolveOld!: (value: RouteData) => void;
      let resolveNew!: (value: RouteData) => void;
      const oldRequest = new Promise<RouteData>((resolve) => {
        resolveOld = resolve;
      });
      const newRequest = new Promise<RouteData>((resolve) => {
        resolveNew = resolve;
      });
      let fetchCount = 0;

      // deno-lint-ignore no-explicit-any
      (loader as any).fetchPageData = () => {
        fetchCount++;
        return fetchCount === 1 ? oldRequest : newRequest;
      };

      const firstLoad = loader.loadPage("/race");
      loader.clearCache();
      const secondLoad = loader.loadPage("/race");

      resolveOld(oldData);
      await firstLoad;

      assertEquals(loader.getCached("/race"), undefined);
      assertStrictEquals(loader.loadPage("/race"), secondLoad);
      assertEquals(fetchCount, 2);

      resolveNew(newData);
      assertEquals(await secondLoad, newData);
      assertEquals(loader.getCached("/race"), newData);
    });
  });
});
