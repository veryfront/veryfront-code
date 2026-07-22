import { JSDOM } from "npm:jsdom@28.0.0";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { boot, VeryfrontRouter } from "./router.ts";
import { getNavigationStore } from "./navigation-store.ts";
import type { RouteData } from "#veryfront/routing";

const NAVIGATION_STORE_KEY = Symbol.for("veryfront.navigation.store.v1");

/** Drop the cross-bundle store so each test starts with fresh subscribers. */
function resetNavigationStore(): void {
  delete (globalThis as Record<symbol, unknown>)[NAVIGATION_STORE_KEY];
}

function installDom(url: string): () => void {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url });
  const window = dom.window;
  const keys = [
    "window",
    "document",
    "navigator",
    "self",
    "history",
    "location",
    "addEventListener",
    "removeEventListener",
    "scrollTo",
  ] as const;
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const key of keys) previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  const replacements = {
    window,
    document: window.document,
    navigator: window.navigator,
    self: window,
    history: window.history,
    location: window.location,
    addEventListener: window.addEventListener.bind(window),
    removeEventListener: window.removeEventListener.bind(window),
    scrollTo: () => {},
  };
  for (const [key, value] of Object.entries(replacements)) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }
  resetNavigationStore();
  return () => {
    for (const key of keys) {
      const descriptor = previous.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
    resetNavigationStore();
    dom.window.close();
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

  it("restores the previous SPA handler when the newest registration is disposed", async () => {
    const restore = installDom("https://example.com/");
    try {
      const router = new VeryfrontRouter({ baseUrl: "https://example.com" });
      const calls: string[] = [];
      const releaseFirst = router.registerNavigationHandler(async () => {
        calls.push("first");
      });
      const releaseSecond = router.registerNavigationHandler(async () => {
        calls.push("second");
      });

      releaseSecond();
      releaseSecond();
      // deno-lint-ignore no-explicit-any
      await (router as any).spaNavigationHandler({});
      assertEquals(calls, ["first"]);

      releaseFirst();
      // deno-lint-ignore no-explicit-any
      assertEquals((router as any).spaNavigationHandler, null);
      router.destroy();
    } finally {
      restore();
    }
  });

  it("an older SPA registration cannot clear a newer handler", async () => {
    const restore = installDom("https://example.com/");
    try {
      const router = new VeryfrontRouter({ baseUrl: "https://example.com" });
      const calls: string[] = [];
      const releaseFirst = router.registerNavigationHandler(async () => {
        calls.push("first");
      });
      const releaseSecond = router.registerNavigationHandler(async () => {
        calls.push("second");
      });

      releaseFirst();
      // deno-lint-ignore no-explicit-any
      await (router as any).spaNavigationHandler({});
      assertEquals(calls, ["second"]);

      releaseSecond();
      router.destroy();
    } finally {
      restore();
    }
  });

  it("destroy releases the router's shared navigation ownership", async () => {
    const restore = installDom("https://example.com/");
    try {
      const router = new VeryfrontRouter({ baseUrl: "https://example.com" });
      const loads = spyOnLoaders(router);
      router.destroy();

      let assigned = "";
      Object.defineProperty(globalThis, "location", {
        configurable: true,
        value: {
          assign(href: string) {
            assigned = href;
          },
          hash: "",
          hostname: "example.com",
          pathname: "/",
          search: "",
        },
        writable: true,
      });

      await getNavigationStore().navigate("/after-destroy");
      assertEquals(loads, []);
      assertEquals(assigned, "/after-destroy");
    } finally {
      restore();
    }
  });

  it("honours replace and none when the store falls back to browser navigation", async () => {
    const restore = installDom("https://example.com/");
    try {
      const assigned: string[] = [];
      const replaced: string[] = [];
      Object.defineProperty(globalThis, "location", {
        configurable: true,
        value: {
          assign(href: string) {
            assigned.push(href);
          },
          replace(href: string) {
            replaced.push(href);
          },
          hash: "",
          hostname: "example.com",
          pathname: "/",
          search: "",
        },
        writable: true,
      });

      const store = getNavigationStore();
      await store.navigate("/push");
      await store.navigate("/replace", { history: "replace" });
      await store.navigate("/already-current", { history: "none" });

      assertEquals(assigned, ["/push"]);
      assertEquals(replaced, ["/replace"]);
    } finally {
      restore();
    }
  });

  it("can destroy against a legacy v1 store whose setNavigator returns void", () => {
    const restore = installDom("https://example.com/");
    try {
      let navigator: (href: string, options?: unknown) => Promise<void> = () => Promise.resolve();
      (globalThis as Record<symbol, unknown>)[NAVIGATION_STORE_KEY] = {
        subscribe: () => () => {},
        getHref: () => "/",
        notify: () => {},
        navigate: (href: string, options?: unknown) => navigator(href, options),
        setNavigator(next: typeof navigator) {
          navigator = next;
          // The original v1 protocol returned void.
        },
      };

      const router = new VeryfrontRouter({ baseUrl: "https://example.com" });
      router.destroy();
    } finally {
      restore();
    }
  });

  it("cancels deferred initialization and permits a fresh boot after destroy", () => {
    const restore = installDom("https://example.com/");
    const globalWithRouter = globalThis as typeof globalThis & {
      veryFrontRouter?: VeryfrontRouter;
    };
    try {
      delete globalWithRouter.veryFrontRouter;
      Object.defineProperty(document, "readyState", {
        configurable: true,
        value: "loading",
      });

      const first = boot({ baseUrl: "https://example.com" })!;
      let initCalls = 0;
      first.init = () => {
        initCalls++;
      };

      first.destroy();
      document.dispatchEvent(new globalThis.window.Event("DOMContentLoaded"));
      const replacement = boot({ baseUrl: "https://example.com" })!;

      assertEquals(initCalls, 0);
      assertEquals(replacement === first, false);
      replacement.destroy();
    } finally {
      delete globalWithRouter.veryFrontRouter;
      restore();
    }
  });

  it("destroying an older boot does not clear a newer global owner", () => {
    const restore = installDom("https://example.com/");
    const globalWithRouter = globalThis as typeof globalThis & {
      veryFrontRouter?: VeryfrontRouter;
    };
    try {
      delete globalWithRouter.veryFrontRouter;
      const older = boot({ baseUrl: "https://example.com" })!;
      const newer = new VeryfrontRouter({ baseUrl: "https://example.com" });
      globalWithRouter.veryFrontRouter = newer;

      older.destroy();

      assertEquals(globalWithRouter.veryFrontRouter === newer, true);
      newer.destroy();
    } finally {
      delete globalWithRouter.veryFrontRouter;
      restore();
    }
  });

  it("uses the global SPA handler when the app mounts before the router", async () => {
    const restore = installDom("https://example.com/");
    const globalWithSpaHandler = globalThis as typeof globalThis & {
      __VERYFRONT_SPA_MODE__?: boolean;
      __VERYFRONT_SPA_NAVIGATE__?: (data: unknown) => Promise<void>;
    };
    try {
      const received: unknown[] = [];
      const pageData = { slug: "/spa" };
      globalWithSpaHandler.__VERYFRONT_SPA_MODE__ = true;
      globalWithSpaHandler.__VERYFRONT_SPA_NAVIGATE__ = (data) => {
        received.push(data);
        return Promise.resolve();
      };

      const router = new VeryfrontRouter({ baseUrl: "https://example.com" });
      const htmlLoads: string[] = [];
      // deno-lint-ignore no-explicit-any
      (router as any).pageLoader.loadSpaPageData = () => Promise.resolve(pageData);
      // deno-lint-ignore no-explicit-any
      (router as any).loadPage = (path: string) => {
        htmlLoads.push(path);
        return Promise.resolve();
      };

      await router.navigate("/spa");

      assertEquals(received, [pageData]);
      assertEquals(htmlLoads, []);
      router.destroy();
    } finally {
      delete globalWithSpaHandler.__VERYFRONT_SPA_MODE__;
      delete globalWithSpaHandler.__VERYFRONT_SPA_NAVIGATE__;
      restore();
    }
  });

  it("destroying an older router does not clear a newer router's navigation ownership", async () => {
    const restore = installDom("https://example.com/");
    try {
      const older = new VeryfrontRouter({ baseUrl: "https://example.com" });
      const newer = new VeryfrontRouter({ baseUrl: "https://example.com" });
      const olderLoads = spyOnLoaders(older);
      const newerLoads = spyOnLoaders(newer);

      older.destroy();
      await getNavigationStore().navigate("/new-owner");

      assertEquals(olderLoads, []);
      assertEquals(newerLoads, ["/new-owner"]);
      newer.destroy();
    } finally {
      restore();
    }
  });

  it("destroying the newest router restores the previous navigation owner", async () => {
    const restore = installDom("https://example.com/");
    try {
      const older = new VeryfrontRouter({ baseUrl: "https://example.com" });
      const newer = new VeryfrontRouter({ baseUrl: "https://example.com" });
      const olderLoads = spyOnLoaders(older);
      const newerLoads = spyOnLoaders(newer);

      newer.destroy();
      await getNavigationStore().navigate("/restored-owner");

      assertEquals(olderLoads, ["/restored-owner"]);
      assertEquals(newerLoads, []);
      older.destroy();
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
