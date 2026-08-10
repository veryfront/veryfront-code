import { JSDOM } from "npm:jsdom@28.0.0";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontRouter } from "./router.ts";
import { getNavigationStore } from "./navigation-store.ts";
import type { RouteData } from "#veryfront/routing";

const NAVIGATION_STORE_KEY = Symbol.for("veryfront.navigation.store.v1");
const DOM_GLOBAL_KEYS = [
  "window",
  "document",
  "navigator",
  "self",
  "history",
  "location",
  "addEventListener",
  "removeEventListener",
  "dispatchEvent",
] as const;

/** Drop the cross-bundle store so each test starts with fresh subscribers. */
function resetNavigationStore(): void {
  delete (globalThis as Record<symbol, unknown>)[NAVIGATION_STORE_KEY];
}

function installDom(url: string): () => void {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url });
  const window = dom.window;
  const previous = new Map(
    DOM_GLOBAL_KEYS.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const),
  );
  const globals = {
    window,
    document: window.document,
    navigator: window.navigator,
    self: window,
    history: window.history,
    location: window.location,
    addEventListener: window.addEventListener.bind(window),
    removeEventListener: window.removeEventListener.bind(window),
    dispatchEvent: window.dispatchEvent.bind(window),
  };
  for (const key of DOM_GLOBAL_KEYS) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      enumerable: previous.get(key)?.enumerable ?? true,
      value: globals[key],
      writable: true,
    });
  }
  resetNavigationStore();
  return () => {
    for (const key of DOM_GLOBAL_KEYS) {
      const descriptor = previous.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    resetNavigationStore();
    dom.window.close();
  };
}

/** Route parsing needs a DOMParser; JSDOM's globals do not install one. */
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

/** Replace the private page loaders with spies so we can observe refetches. */
function spyOnLoaders(router: VeryfrontRouter): string[] {
  const loads: string[] = [];
  const load = (path: string): Promise<void> => {
    loads.push(path);
    return Promise.resolve();
  };
  // deno-lint-ignore no-explicit-any
  (router as any).loadPage = load;
  // deno-lint-ignore no-explicit-any
  (router as any).loadSpaPage = load;
  return loads;
}

describe("rendering/client/VeryfrontRouter — soft same-route navigation", () => {
  it("restores host global descriptors without changing unrelated globals", () => {
    const previous = new Map(
      DOM_GLOBAL_KEYS.map((key) =>
        [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const
      ),
    );
    const unrelatedKey = Symbol("unrelated-router-test-global");
    const unrelatedGlobal = globalThis as typeof globalThis & Record<symbol, unknown>;
    unrelatedGlobal[unrelatedKey] = "preserved";

    const restore = installDom("https://example.com/");
    try {
      assertEquals(globalThis.navigator.userAgent.length > 0, true);
    } finally {
      restore();
    }

    try {
      for (const key of DOM_GLOBAL_KEYS) {
        assertEquals(Object.getOwnPropertyDescriptor(globalThis, key), previous.get(key));
      }
      assertEquals(unrelatedGlobal[unrelatedKey], "preserved");
    } finally {
      Reflect.deleteProperty(unrelatedGlobal, unrelatedKey);
    }
  });

  it("initializes route state from the full browser URL", () => {
    const restore = installDom("https://example.com/dashboard?tab=a#top");
    try {
      const router = new VeryfrontRouter({ baseUrl: "https://example.com" });

      // deno-lint-ignore no-explicit-any
      assertEquals((router as any).currentPath, "/dashboard?tab=a#top");
    } finally {
      restore();
    }
  });

  it("soft path (shouldRevalidate=false) updates the URL and notifies, no page load", async () => {
    const restore = installDom("https://example.com/dashboard");
    try {
      const router = new VeryfrontRouter({
        baseUrl: "https://example.com",
        shouldRevalidate: () => false,
      });
      const loads = spyOnLoaders(router);

      let notifications = 0;
      getNavigationStore().subscribe(() => notifications++);

      await router.navigate("/dashboard?tab=activity");

      assertEquals(loads, []);
      assertEquals(notifications, 1);
      assertEquals(globalThis.location.search, "?tab=activity");
      assertEquals(getNavigationStore().getHref(), "/dashboard?tab=activity");
    } finally {
      restore();
    }
  });

  it("by default a same-route query change revalidates (refetches)", async () => {
    const restore = installDom("https://example.com/dashboard");
    try {
      const router = new VeryfrontRouter({ baseUrl: "https://example.com" });
      const loads = spyOnLoaders(router);

      // No `shouldRevalidate` configured — the default refetches so server data
      // keyed on the query is never shown stale.
      await router.navigate("/dashboard?tab=activity");

      assertEquals(loads, ["/dashboard?tab=activity"]);
      assertEquals(globalThis.location.search, "?tab=activity");
    } finally {
      restore();
    }
  });

  it("a route change runs a full page load (and notifies once)", async () => {
    const restore = installDom("https://example.com/dashboard");
    try {
      const router = new VeryfrontRouter({ baseUrl: "https://example.com" });
      const loads = spyOnLoaders(router);

      let notifications = 0;
      getNavigationStore().subscribe(() => notifications++);

      await router.navigate("/settings");

      assertEquals(loads, ["/settings"]);
      assertEquals(notifications, 1);
    } finally {
      restore();
    }
  });

  it("hands scripted cached routes to the document loader without soft completion", async () => {
    const restore = installDom("https://example.com/current");
    const originalLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
    try {
      const navigated: string[] = [];
      const router = new VeryfrontRouter({
        baseUrl: "https://example.com",
        onNavigate: (url) => navigated.push(url),
      });
      // deno-lint-ignore no-explicit-any
      (router as any).pageLoader.setCache("/scripted", {
        html: "<main>Scripted</main>",
        requiresFullDocumentNavigation: true,
      });
      const assigned: string[] = [];
      Object.defineProperty(globalThis, "location", {
        configurable: true,
        value: {
          origin: "https://example.com",
          pathname: "/current",
          search: "",
          hash: "",
          assign: (url: string) => assigned.push(url),
        },
      });

      await router.navigate("/scripted");

      assertEquals(assigned, ["/scripted"]);
      assertEquals(navigated, []);
    } finally {
      if (originalLocation) Object.defineProperty(globalThis, "location", originalLocation);
      else delete (globalThis as Record<string, unknown>).location;
      restore();
    }
  });

  it("hands scripted JSON routes to the document loader instead of the error page", async () => {
    const restore = installDom("https://example.com/current");
    const originalLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
    const originalFetch = globalThis.fetch;
    try {
      const errors: Error[] = [];
      const router = new VeryfrontRouter({
        baseUrl: "https://example.com",
        onError: (error) => errors.push(error),
      });
      // The test observes the navigation decision without mounting a React root.
      // deno-lint-ignore no-explicit-any
      (router as any).root = {};
      // A route-data payload whose fragment carries structured data — no server
      // layouts, so nothing upstream flags it as a document navigation.
      globalThis.fetch = ((input: URL | RequestInfo) =>
        Promise.resolve(
          String(input).startsWith("/_veryfront/data")
            ? Response.json({
              html:
                '<main>Post</main><script type="application/ld+json">{"@type":"Article"}</script>',
              frontmatter: {},
            })
            : new Response("Not Found", { status: 404 }),
        )) as typeof fetch;
      const assigned: string[] = [];
      Object.defineProperty(globalThis, "location", {
        configurable: true,
        value: {
          origin: "https://example.com",
          pathname: "/current",
          search: "",
          hash: "",
          assign: (url: string) => assigned.push(url),
        },
      });

      await router.navigate("/blog/post");

      assertEquals(assigned, ["/blog/post"]);
      assertEquals(errors, []);
      assertEquals(
        document.getElementById("root")?.innerHTML,
        "",
        "A scripted destination must not replace the route with an error page",
      );
    } finally {
      globalThis.fetch = originalFetch;
      if (originalLocation) Object.defineProperty(globalThis, "location", originalLocation);
      else delete (globalThis as Record<string, unknown>).location;
      restore();
    }
  });

  it("hands a response without an app root to the document loader", async () => {
    const restore = installDom("https://example.com/current");
    const restoreDOMParser = installJSDOMParser();
    const originalLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
    const originalFetch = globalThis.fetch;
    try {
      const errors: Error[] = [];
      const router = new VeryfrontRouter({
        baseUrl: "https://example.com",
        onError: (error) => errors.push(error),
      });
      // deno-lint-ignore no-explicit-any
      (router as any).root = {};
      document.getElementById("root")!.innerHTML = "Live app";
      // A proxy interstitial: a 200 that is a complete document but never
      // mounts the app, so it has no route content the router can commit.
      const interstitial = `<!doctype html><html><head><title>Just a moment</title></head><body>
          <div class="interstitial"><h1>Checking your browser</h1></div>
        </body></html>`;
      globalThis.fetch = ((input: URL | RequestInfo) =>
        Promise.resolve(
          String(input).startsWith("/_veryfront/data")
            ? new Response("Not Found", { status: 404 })
            : new Response(interstitial, { headers: { "content-type": "text/html" } }),
        )) as typeof fetch;
      const assigned: string[] = [];
      Object.defineProperty(globalThis, "location", {
        configurable: true,
        value: {
          origin: "https://example.com",
          pathname: "/current",
          search: "",
          hash: "",
          assign: (url: string) => assigned.push(url),
        },
      });

      await router.navigate("/gated");

      // Without the handoff the router completes the navigation: the URL
      // advances to /gated while the previous page stays mounted, and the
      // interstitial's own scripts never run.
      assertEquals(assigned, ["/gated"]);
      assertEquals(errors, []);
      assertEquals(document.getElementById("root")?.innerHTML, "Live app");
    } finally {
      globalThis.fetch = originalFetch;
      if (originalLocation) Object.defineProperty(globalThis, "location", originalLocation);
      else delete (globalThis as Record<string, unknown>).location;
      restoreDOMParser();
      restore();
    }
  });

  it("a popstate (history: none) soft query change updates without a load", async () => {
    const restore = installDom("https://example.com/dashboard?tab=a");
    try {
      const router = new VeryfrontRouter({
        baseUrl: "https://example.com",
        shouldRevalidate: () => false,
      });
      const loads = spyOnLoaders(router);

      let notifications = 0;
      getNavigationStore().subscribe(() => notifications++);

      // Mirrors how the popstate handler calls navigate: history left untouched.
      await router.navigate("/dashboard?tab=b", { history: "none" });

      assertEquals(loads, []);
      assertEquals(notifications, 1);
      // `history: "none"` must not push a new entry — the URL was set by the back/forward.
      assertEquals(globalThis.location.search, "?tab=a");
    } finally {
      restore();
    }
  });

  it("accepts the deprecated boolean history arg (false = no history change)", async () => {
    const restore = installDom("https://example.com/dashboard?tab=a");
    try {
      const router = new VeryfrontRouter({
        baseUrl: "https://example.com",
        shouldRevalidate: () => false,
      });
      spyOnLoaders(router);

      // Legacy call shape `navigate(url, false)` maps to `{ history: "none" }`.
      await router.navigate("/dashboard?tab=b", false);

      assertEquals(globalThis.location.search, "?tab=a");
    } finally {
      restore();
    }
  });

  it("getHref includes the hash and keeps it out of the query", async () => {
    const restore = installDom("https://example.com/docs");
    try {
      const router = new VeryfrontRouter({ baseUrl: "https://example.com" });
      spyOnLoaders(router);

      await router.navigate("/docs?tab=api#install");

      // The snapshot is the full location — pathname + search + hash — so a
      // hash-only change is observable rather than silently swallowed.
      assertEquals(getNavigationStore().getHref(), "/docs?tab=api#install");
      assertEquals(globalThis.location.hash, "#install");
    } finally {
      restore();
    }
  });

  it("unsubscribe stops further notifications", async () => {
    const restore = installDom("https://example.com/dashboard");
    try {
      const router = new VeryfrontRouter({ baseUrl: "https://example.com" });
      spyOnLoaders(router);

      let notifications = 0;
      const unsubscribe = getNavigationStore().subscribe(() => notifications++);
      await router.navigate("/dashboard?a=1");
      unsubscribe();
      await router.navigate("/dashboard?a=2");

      assertEquals(notifications, 1);
    } finally {
      restore();
    }
  });

  it("ignores a stale navigation that resolves after a newer one", async () => {
    const restore = installDom("https://example.com/");
    try {
      const completed: string[] = [];
      const router = new VeryfrontRouter({
        baseUrl: "https://example.com",
        onComplete: (url) => completed.push(url),
      });
      const first = Promise.withResolvers<RouteData>();
      const second = Promise.withResolvers<RouteData>();
      // deno-lint-ignore no-explicit-any
      const pageLoader = (router as any).pageLoader;
      pageLoader.loadPage = (path: string) => path === "/first" ? first.promise : second.promise;

      const firstNavigation = router.navigate("/first");
      const secondNavigation = router.navigate("/second");

      second.resolve({ html: "second" });
      await secondNavigation;
      first.resolve({ html: "first" });
      await firstNavigation;

      // deno-lint-ignore no-explicit-any
      assertEquals((router as any).currentPath, "/second");
      assertEquals(globalThis.location.pathname, "/second");
      assertEquals(completed, ["/second"]);
    } finally {
      restore();
    }
  });

  it("clears a stale loading state when the newer navigation is cached", async () => {
    const restore = installDom("https://example.com/");
    try {
      const router = new VeryfrontRouter({ baseUrl: "https://example.com" });
      const first = Promise.withResolvers<RouteData>();
      const loadingStates: boolean[] = [];
      // deno-lint-ignore no-explicit-any
      const pageLoader = (router as any).pageLoader;
      pageLoader.loadPage = () => first.promise;
      pageLoader.setCache("/cached", { html: "cached" });
      // deno-lint-ignore no-explicit-any
      (router as any).pageTransition.setLoadingState = (loading: boolean) => {
        loadingStates.push(loading);
      };

      const staleNavigation = router.navigate("/slow");
      await router.navigate("/cached");

      assertEquals(loadingStates.at(-1), false);

      first.resolve({ html: "slow" });
      await staleNavigation;
    } finally {
      restore();
    }
  });

  it("clears a stale loading state when the newer navigation is soft", async () => {
    const restore = installDom("https://example.com/dashboard");
    try {
      const router = new VeryfrontRouter({
        baseUrl: "https://example.com",
        shouldRevalidate: () => false,
      });
      const first = Promise.withResolvers<RouteData>();
      const loadingStates: boolean[] = [];
      // deno-lint-ignore no-explicit-any
      (router as any).pageLoader.loadPage = () => first.promise;
      // deno-lint-ignore no-explicit-any
      (router as any).pageTransition.setLoadingState = (loading: boolean) => {
        loadingStates.push(loading);
      };

      const staleNavigation = router.navigate("/slow");
      await router.navigate("/dashboard?tab=activity");

      assertEquals(loadingStates.at(-1), false);

      first.resolve({ html: "slow" });
      await staleNavigation;
    } finally {
      restore();
    }
  });

  it("clears an in-flight loading state when destroyed", async () => {
    const restore = installDom("https://example.com/");
    try {
      const router = new VeryfrontRouter({ baseUrl: "https://example.com" });
      const first = Promise.withResolvers<RouteData>();
      const loadingStates: boolean[] = [];
      // deno-lint-ignore no-explicit-any
      (router as any).pageLoader.loadPage = () => first.promise;
      // deno-lint-ignore no-explicit-any
      (router as any).pageTransition.setLoadingState = (loading: boolean) => {
        loadingStates.push(loading);
      };

      const staleNavigation = router.navigate("/slow");
      router.destroy();

      assertEquals(loadingStates.at(-1), false);

      first.resolve({ html: "slow" });
      await staleNavigation;
    } finally {
      restore();
    }
  });

  it("restores popstate scroll for the target route", async () => {
    const restore = installDom("https://example.com/from");
    try {
      const router = new VeryfrontRouter({ baseUrl: "https://example.com" });
      let restoredScrollY: number | undefined;
      // The test observes the transition call without mounting a real React root.
      // deno-lint-ignore no-explicit-any
      (router as any).root = {};
      // deno-lint-ignore no-explicit-any
      (router as any).pageLoader.loadPage = () => Promise.resolve({ html: "target" });
      // deno-lint-ignore no-explicit-any
      (router as any).navigationHandlers.isPopStateNav = true;
      // deno-lint-ignore no-explicit-any
      (router as any).navigationHandlers.scrollPositions.set("/target", 321);
      // deno-lint-ignore no-explicit-any
      (router as any).pageTransition.updatePage = (
        _data: RouteData,
        _isPopState: boolean,
        scrollY: number,
      ) => {
        restoredScrollY = scrollY;
      };

      await router.navigate("/target", { history: "none" });

      assertEquals(restoredScrollY, 321);
    } finally {
      restore();
    }
  });
});
