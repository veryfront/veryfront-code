import "#veryfront/schemas/_test-setup.ts";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  descriptorFromHeadProps,
  serializeManagedHeadPayload,
} from "#veryfront/html/managed-head-protocol.ts";
import { PageLoader } from "./page-loader.ts";
import type { RouteData, SpaPageData } from "./types.ts";

const DEPENDENCY_PINNING_HEADER = "x-veryfront-dependency-pins";

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

function makeHydrationDocument(getJson: () => string): Document {
  const hydrationElement = {
    id: "veryfront-hydration-data",
    tagName: "SCRIPT",
    get textContent() {
      return getJson();
    },
    getAttribute: (name: string) => name === "type" ? "application/json" : null,
  };
  return {
    body: { firstElementChild: hydrationElement },
    querySelectorAll: () => [hydrationElement],
  } as unknown as Document;
}

function installSnapshotDOMParser(): () => void {
  const globalWithDOMParser = globalThis as typeof globalThis & {
    DOMParser: typeof DOMParser;
  };
  const originalDOMParser = globalWithDOMParser.DOMParser;

  class SnapshotDOMParser {
    parseFromString(html: string) {
      const rootMatch = html.match(/<div id="root"[^>]*>(.*?)<\/div>/s);
      const hydrationMatch = html.match(
        /<script id="veryfront-hydration-data"[^>]*>(.*?)<\/script>/s,
      );
      const hydrationElement = hydrationMatch
        ? {
          id: "veryfront-hydration-data",
          tagName: "SCRIPT",
          textContent: hydrationMatch[1],
          getAttribute: (name: string) => name === "type" ? "application/json" : null,
        }
        : null;
      return {
        getElementById: (id: string) =>
          id === "root"
            ? (rootMatch ? { innerHTML: rootMatch[1] } : null)
            : id === "veryfront-hydration-data"
            ? hydrationElement
            : null,
        querySelector: () => null,
        querySelectorAll: () => hydrationElement ? [hydrationElement] : [],
        body: { firstElementChild: hydrationElement },
      };
    }
  }

  globalWithDOMParser.DOMParser = SnapshotDOMParser as unknown as typeof DOMParser;
  return () => {
    globalWithDOMParser.DOMParser = originalDOMParser;
  };
}

function installJSDOMParser(): () => void {
  const globalWithDOMParser = globalThis as typeof globalThis & {
    DOMParser: typeof DOMParser;
  };
  const originalDOMParser = globalWithDOMParser.DOMParser;
  const owner = new JSDOM("");
  globalWithDOMParser.DOMParser = owner.window.DOMParser as unknown as typeof DOMParser;
  return () => {
    globalWithDOMParser.DOMParser = originalDOMParser;
    owner.window.close();
  };
}

describe("routing/client/page-loader", () => {
  describe("cache operations", () => {
    it("preserves the legacy path identity when pinning is off", () => {
      const loader = new PageLoader(
        makeHydrationDocument(() => JSON.stringify({ dependencyPinningCacheKey: "off" })),
      );

      loader.setCache("/legacy", makeRouteData());
      const keys = [
        ...(loader as unknown as { cache: Map<string, RouteData> }).cache.keys(),
      ];

      assertEquals(keys, ["/legacy"]);
    });

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

  describe("page data URL", () => {
    it("extracts trusted managed head without accepting root payload markers", async () => {
      const originalFetch = globalThis.fetch;
      const restoreDOMParser = installJSDOMParser();
      const structured = serializeManagedHeadPayload([
        descriptorFromHeadProps("meta", {
          name: "description",
          content: "Destination",
        })!,
      ]);
      const committed = serializeManagedHeadPayload([
        descriptorFromHeadProps("title", { children: "Destination title" })!,
      ]);
      const fullDocument = `<!doctype html><html><head>
      </head><body>
        <script id="veryfront-hydration-data" type="application/json">${
        JSON.stringify({ managedHeadPayload: structured })
      }</script>
      <div id="root"><main>Destination</main>
        <div data-veryfront-head="1" data-vf-react-head-owner="1"
          data-vf-ssr-head="${committed}"></div></div></body></html>`;
      globalThis.fetch = () => Promise.resolve(Response.json({ html: fullDocument }));

      try {
        const data = await new PageLoader().fetchPageData("/destination");
        assertEquals(data.html?.includes("<main>Destination</main>"), true);
        assertEquals(data.managedHead, [
          {
            tagName: "meta",
            attributes: [["content", "Destination"], ["name", "description"]],
          },
        ]);
      } finally {
        globalThis.fetch = originalFetch;
        restoreDOMParser();
      }
    });

    it("flags a JSON fragment carrying inline scripts as a document navigation", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = () =>
        Promise.resolve(
          Response.json({
            html:
              '<main>Post</main><script type="application/ld+json">{"@type":"Article"}</script>',
            frontmatter: {},
          }),
        );

      try {
        // Inline scripts never execute through an innerHTML transition, so the
        // route belongs to the browser's document loader.
        const data = await new PageLoader().fetchPageData("/blog/post");
        assertEquals(data.requiresFullDocumentNavigation, true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("flags a JSON payload with managed head scripts as a document navigation", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = () =>
        Promise.resolve(
          Response.json({
            html: "<main>Post</main>",
            managedHead: [{ tagName: "script", attributes: [["src", "/analytics.js"]] }],
          }),
        );

      try {
        const data = await new PageLoader().fetchPageData("/blog/post");
        assertEquals(data.requiresFullDocumentNavigation, true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("leaves script-free JSON routes on the soft transition path", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = () =>
        Promise.resolve(Response.json({ html: "<main>Post</main>", frontmatter: {} }));

      try {
        const data = await new PageLoader().fetchPageData("/blog/post");
        assertEquals(data.requiresFullDocumentNavigation, undefined);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("reports no route html when a 200 response carries no app root", async () => {
      const originalFetch = globalThis.fetch;
      const restoreDOMParser = installJSDOMParser();
      // A proxy interstitial or custom error page: a 200 that is a complete
      // document but never mounts the app.
      const interstitial = `<!doctype html><html><head><title>Just a moment</title></head><body>
          <div class="interstitial"><h1>Checking your browser</h1></div>
        </body></html>`;
      globalThis.fetch = (input: URL | RequestInfo) =>
        Promise.resolve(
          String(input).startsWith("/_veryfront/data")
            ? new Response("Not Found", { status: 404 })
            : new Response(interstitial, { headers: { "content-type": "text/html" } }),
        );

      try {
        const data = await new PageLoader().fetchPageData("/about");

        // Reporting absent content alone still lets the router commit the
        // navigation and advance the URL over the old page. The destination has
        // to reach the browser's document loader so the interstitial runs.
        assertEquals(data.requiresFullDocumentNavigation, true);
        // `html: ""` would be read downstream as an intentionally empty route
        // and would clear the mounted app; absent html skips the transition.
        assertEquals(data.html, undefined);
      } finally {
        globalThis.fetch = originalFetch;
        restoreDOMParser();
      }
    });

    it("rejects the navigation when the HTML fallback fetch fails", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (input: URL | RequestInfo) =>
        Promise.resolve(
          String(input).startsWith("/_veryfront/data")
            ? new Response("Not Found", { status: 404 })
            : new Response("boom", { status: 500 }),
        );

      try {
        const error = await assertRejects(
          () => new PageLoader().fetchPageData("/about"),
          Error,
          "Failed to fetch /about",
          "a failed HTML fetch must reject instead of resolving an empty page",
        );
        assertEquals(
          (error as { status?: number }).status,
          500,
          "the rejection must carry the upstream response status",
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("places the JSON suffix before query parameters and preserves application pins while off", async () => {
      const originalFetch = globalThis.fetch;
      let requestedUrl = "";
      let requestedPins: string | null = null;
      globalThis.fetch = (input: URL | RequestInfo, init?: RequestInit) => {
        requestedUrl = String(input);
        requestedPins = new Headers(init?.headers).get(
          DEPENDENCY_PINNING_HEADER,
        );
        return Promise.resolve(Response.json({ html: "root" }));
      };

      try {
        await new PageLoader().fetchPageData(
          "/?pins=app-value&page=2#section",
        );
        assertEquals(
          requestedUrl,
          "/_veryfront/data/index.json?pins=app-value&page=2",
        );
        assertEquals(requestedPins, null);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("pins requests to immutable A and rejects an HTML fallback identified as B", async () => {
      const originalFetch = globalThis.fetch;
      const requestedUrls: string[] = [];
      const requestedPins: Array<string | null> = [];
      const reloads: string[] = [];
      let hydrationJson = JSON.stringify({
        dependencyPinningCacheKey: "on:snapshot-a",
      });
      const loader = new PageLoader(
        makeHydrationDocument(() => hydrationJson),
        (url) => reloads.push(url),
      );

      // Replacing the document's hydration state cannot retarget an existing
      // loader, its cache, or its in-flight requests.
      hydrationJson = JSON.stringify({
        dependencyPinningCacheKey: "on:snapshot-b",
      });
      globalThis.fetch = (input: URL | RequestInfo, init?: RequestInit) => {
        requestedUrls.push(String(input));
        requestedPins.push(
          new Headers(init?.headers).get(DEPENDENCY_PINNING_HEADER),
        );
        if (requestedUrls.length === 1) {
          return Promise.resolve(new Response("Not Found", { status: 404 }));
        }
        return Promise.resolve(
          new Response("snapshot B", {
            headers: {
              "x-veryfront-dependency-pins": "on:snapshot-b",
            },
          }),
        );
      };

      try {
        await assertRejects(
          () =>
            loader.fetchPageData(
              "/docs?view=full&pins=app-value#section",
            ),
          Error,
          "Dependency snapshot mismatch",
        );
        assertEquals(requestedUrls, [
          "/_veryfront/data/docs.json?view=full&pins=app-value",
          "/docs?view=full&pins=app-value#section",
        ]);
        assertEquals(requestedPins, ["on:snapshot-a", "on:snapshot-a"]);
        assertEquals(reloads, ["/docs?view=full&pins=app-value#section"]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("does not silently fall back to HTML when the JSON snapshot is unavailable", async () => {
      const originalFetch = globalThis.fetch;
      let fetchCalls = 0;
      const reloads: string[] = [];
      globalThis.fetch = () => {
        fetchCalls++;
        return Promise.resolve(
          new Response("Unknown dependency snapshot", { status: 409 }),
        );
      };

      try {
        const loader = new PageLoader(
          makeHydrationDocument(() =>
            JSON.stringify({
              dependencyPinningCacheKey: "on:snapshot-a",
            })
          ),
          (url) => reloads.push(url),
        );
        await assertRejects(
          () => loader.fetchPageData("/docs"),
          Error,
          "Dependency snapshot is unavailable",
        );
        assertEquals(fetchCalls, 1);
        assertEquals(reloads, ["/docs"]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("starts at most one document reload per loader on repeated snapshot conflicts", async () => {
      const originalFetch = globalThis.fetch;
      const reloads: string[] = [];
      globalThis.fetch = () =>
        Promise.resolve(new Response("Unknown dependency snapshot", { status: 409 }));

      try {
        const loader = new PageLoader(
          makeHydrationDocument(() =>
            JSON.stringify({
              dependencyPinningCacheKey: "on:snapshot-a",
            })
          ),
          (url) => reloads.push(url),
        );
        await assertRejects(
          () => loader.fetchPageData("/docs"),
          Error,
          "Dependency snapshot is unavailable",
        );
        await assertRejects(
          () => loader.fetchPageData("/other"),
          Error,
          "Dependency snapshot is unavailable",
        );

        assertEquals(
          reloads,
          ["/docs"],
          "a loader may start at most one document reload per snapshot conflict",
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("retries the document reload when the first reload attempt throws", async () => {
      const originalFetch = globalThis.fetch;
      let reloadCalls = 0;
      globalThis.fetch = () =>
        Promise.resolve(new Response("Unknown dependency snapshot", { status: 409 }));

      try {
        const loader = new PageLoader(
          makeHydrationDocument(() =>
            JSON.stringify({
              dependencyPinningCacheKey: "on:snapshot-a",
            })
          ),
          () => {
            reloadCalls++;
            if (reloadCalls === 1) throw new Error("assign failed");
          },
        );
        await assertRejects(
          () => loader.fetchPageData("/docs"),
          Error,
          "Dependency snapshot is unavailable",
        );
        await assertRejects(
          () => loader.fetchPageData("/other"),
          Error,
          "Dependency snapshot is unavailable",
        );

        assertEquals(
          reloadCalls,
          2,
          "a failed document reload must release the once-per-loader guard so the next conflict can retry",
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("rejects route data whose response identity does not match the loader", async () => {
      const originalFetch = globalThis.fetch;
      const reloads: string[] = [];
      let fetchCalls = 0;
      globalThis.fetch = () => {
        fetchCalls++;
        return Promise.resolve(
          Response.json({
            html: "snapshot B",
            dependencyPinningCacheKey: "on:snapshot-b",
          }),
        );
      };

      try {
        const loader = new PageLoader(
          makeHydrationDocument(() =>
            JSON.stringify({
              dependencyPinningCacheKey: "on:snapshot-a",
            })
          ),
          (url) => reloads.push(url),
        );
        await assertRejects(
          () => loader.fetchPageData("/docs?pins=app-value"),
          Error,
          "Dependency snapshot mismatch",
        );
        assertEquals(fetchCalls, 1);
        assertEquals(reloads, ["/docs?pins=app-value"]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("rejects HTML whose header is A but hydration body is B", async () => {
      const originalFetch = globalThis.fetch;
      const restoreDOMParser = installSnapshotDOMParser();
      const reloads: string[] = [];
      let fetchCalls = 0;
      globalThis.fetch = () => {
        fetchCalls++;
        if (fetchCalls === 1) {
          return Promise.resolve(new Response("Not Found", { status: 404 }));
        }
        return Promise.resolve(
          new Response(
            `<div id="root">snapshot B</div><script id="veryfront-hydration-data">${
              JSON.stringify({ dependencyPinningCacheKey: "on:snapshot-b" })
            }</script>`,
            {
              headers: {
                "x-veryfront-dependency-pins": "on:snapshot-a",
              },
            },
          ),
        );
      };

      try {
        const loader = new PageLoader(
          makeHydrationDocument(() =>
            JSON.stringify({
              dependencyPinningCacheKey: "on:snapshot-a",
            })
          ),
          (url) => reloads.push(url),
        );
        await assertRejects(
          () => loader.fetchPageData("/docs"),
          Error,
          "Dependency snapshot mismatch in HTML body",
        );
        assertEquals(fetchCalls, 2);
        assertEquals(reloads, ["/docs"]);
      } finally {
        globalThis.fetch = originalFetch;
        restoreDOMParser();
      }
    });

    it("drops a speculative route prefetch conflict without navigating", async () => {
      const originalFetch = globalThis.fetch;
      const reloads: string[] = [];
      globalThis.fetch = () =>
        Promise.resolve(
          new Response("Unknown dependency snapshot", { status: 409 }),
        );

      try {
        const loader = new PageLoader(
          makeHydrationDocument(() =>
            JSON.stringify({
              dependencyPinningCacheKey: "on:snapshot-a",
            })
          ),
          (url) => reloads.push(url),
        );

        await loader.prefetch("/docs?pins=app-value");

        assertEquals(reloads, []);
        assertEquals(loader.isCached("/docs?pins=app-value"), false);
      } finally {
        globalThis.fetch = originalFetch;
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

    it("uses immutable snapshot A and preserves duplicate application pins", async () => {
      const originalFetch = globalThis.fetch;
      let requestedUrl = "";
      let requestedPins: string | null = null;
      let hydrationJson = JSON.stringify({
        dependencyPinningCacheKey: "on:snapshot-a",
      });
      const loader = new PageLoader(makeHydrationDocument(() => hydrationJson));
      hydrationJson = JSON.stringify({
        dependencyPinningCacheKey: "on:snapshot-b",
      });
      globalThis.fetch = (input: URL | RequestInfo, init?: RequestInit) => {
        requestedUrl = String(input);
        requestedPins = new Headers(init?.headers).get(
          DEPENDENCY_PINNING_HEADER,
        );
        return Promise.resolve(
          Response.json(
            makeSpaPageData({
              dependencyPinningCacheKey: "on:snapshot-a",
            }),
          ),
        );
      };

      try {
        await loader.fetchSpaPageData(
          "/?pins=app-a&page=2&pins=app-b#section",
        );
        assertEquals(
          requestedUrl,
          "/_veryfront/page-data/index.json?pins=app-a&page=2&pins=app-b",
        );
        assertEquals(requestedPins, "on:snapshot-a");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("reloads the document when SPA page data has an unknown snapshot", async () => {
      const originalFetch = globalThis.fetch;
      const reloads: string[] = [];
      globalThis.fetch = () =>
        Promise.resolve(
          new Response("Unknown dependency snapshot", { status: 409 }),
        );

      try {
        const loader = new PageLoader(
          makeHydrationDocument(() =>
            JSON.stringify({
              dependencyPinningCacheKey: "on:snapshot-a",
            })
          ),
          (url) => reloads.push(url),
        );
        await assertRejects(
          () =>
            loader.fetchSpaPageData(
              "/docs?view=full&pins=app-value#section",
            ),
          Error,
          "Dependency snapshot is unavailable",
        );
        assertEquals(reloads, ["/docs?view=full&pins=app-value#section"]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("reloads the document when SPA page data is identified as another snapshot", async () => {
      const originalFetch = globalThis.fetch;
      const reloads: string[] = [];
      globalThis.fetch = () =>
        Promise.resolve(
          Response.json(
            makeSpaPageData({
              dependencyPinningCacheKey: "on:snapshot-b",
            }),
          ),
        );

      try {
        const loader = new PageLoader(
          makeHydrationDocument(() =>
            JSON.stringify({
              dependencyPinningCacheKey: "on:snapshot-a",
            })
          ),
          (url) => reloads.push(url),
        );
        await assertRejects(
          () => loader.fetchSpaPageData("/docs"),
          Error,
          "Dependency snapshot mismatch",
        );
        assertEquals(reloads, ["/docs"]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("drops a speculative SPA prefetch conflict without navigating", async () => {
      const originalFetch = globalThis.fetch;
      const reloads: string[] = [];
      globalThis.fetch = () =>
        Promise.resolve(
          new Response("Unknown dependency snapshot", { status: 409 }),
        );

      try {
        const loader = new PageLoader(
          makeHydrationDocument(() =>
            JSON.stringify({
              dependencyPinningCacheKey: "on:snapshot-a",
            })
          ),
          (url) => reloads.push(url),
        );

        await loader.prefetchSpaPageData("/docs?pins=app-value");

        assertEquals(reloads, []);
        assertEquals(
          loader.isSpaDataCached("/docs?pins=app-value"),
          false,
        );
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
  });
});
