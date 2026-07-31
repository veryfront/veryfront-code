import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type {
  ClientRouter,
  HydrationRuntimeEnv,
  ModuleNamespace,
  PageDataPayload,
  ReactLike,
  RuntimeDocument,
  RuntimeElement,
  RuntimeEvent,
  RuntimeFetchInit,
  RuntimeResponse,
  RuntimeWindow,
} from "./env.ts";
import type { ComponentLoader } from "./component-loader.ts";
import type { NavigationStore } from "./navigation-store.ts";
import { createLogging } from "./shared.ts";
import { createRouteTimingRecorder } from "./route-timing.ts";
import { createSnapshotModuleImporter } from "./snapshot-modules.ts";
import {
  readDocumentDependencyPinningCacheKey,
  readInitialHydrationData,
} from "./hydration-data.ts";
import { createRouterRuntime, type RouterRuntime } from "./router.ts";

// The router used to be a template string evaluated with `new Function`, whose
// free variables (window, document, fetch, React, the providers, loadComponent,
// setTimeout/clearTimeout, getNavigationStore) were passed in as parameters.
// Those are now the module's declared dependencies, so this harness injects the
// same stubs the string-surgery harness did — against the real shipped code.

interface FetchCall {
  url: string;
  options: RuntimeFetchInit;
}

interface HistoryCall {
  method: "push" | "replace";
  href: string;
}

interface FakeNavigationStore extends NavigationStore {
  navigator: ((href: string, options?: { history?: string }) => Promise<void> | void) | null;
  assignFallbackCount: number;
  notifications: number;
}

interface ModuleResolutionCall {
  path: string;
  preferRscModule: boolean;
  studioEmbed: boolean;
  releaseAssetModules: Record<string, string> | null;
  releaseId: string | null;
}

interface RouterHarness {
  runtime: RouterRuntime;
  router: ClientRouter;
  window: RuntimeWindow;
  listeners: Record<string, Array<(event: RuntimeEvent) => Promise<void> | void>>;
  fetchCalls: FetchCall[];
  historyCalls: HistoryCall[];
  store: FakeNavigationStore;
  setNextPageData(data: PageDataPayload): void;
  moduleResolutionCalls: ModuleResolutionCall[];
  /** router.params at the moment RouterProvider was built — what the new page renders with. */
  renderedRouterParams(): Record<string, string> | null;
  /** The `params` prop handed to the page component; must be normalized. */
  renderedPageParams(): Record<string, string> | null;
  routeCss(): string | null;
  assignedHref(): string | undefined;
  bodyBusy(): boolean;
  reloads(): number;
}

interface HarnessOptions {
  pathname?: string;
  search?: string;
  hydrationParams?: Record<string, string | string[]>;
  hydrationBuildVersion?: PageDataPayload["buildVersion"];
  hydrationDev?: boolean;
  activeReleaseId?: string;
  hydrationDependencyPinningCacheKey?: string;
  fetchImpl?: (url: string, options: RuntimeFetchInit) => Promise<RuntimeResponse>;
  importModuleImpl?: (moduleUrl: string) => Promise<ModuleNamespace>;
  loadComponentImpl?: (path: string) => Promise<unknown>;
  setTimeoutImpl?: (handler: () => void, timeout?: number) => number;
  clearTimeoutImpl?: (id: number) => void;
  debug?: boolean;
  routerRuntimeExportsNavigationStore?: boolean;
}

function makeElement(onRemove?: (element: RuntimeElement) => void): RuntimeElement {
  return {
    style: {},
    id: "",
    textContent: "",
    setAttribute() {},
    getAttribute() {
      return null;
    },
    prepend() {},
    remove() {
      onRemove?.(this as unknown as RuntimeElement);
    },
    appendChild() {},
  } as unknown as RuntimeElement;
}

function createRouterHarness(options: HarnessOptions = {}): RouterHarness {
  const hydrationJson = JSON.stringify({
    params: options.hydrationParams ?? {},
    buildVersion: options.hydrationBuildVersion,
    dev: options.hydrationDev,
    ...(options.hydrationDependencyPinningCacheKey !== undefined
      ? { dependencyPinningCacheKey: options.hydrationDependencyPinningCacheKey }
      : {}),
  });

  const listeners: RouterHarness["listeners"] = {};
  const addEventListener = (
    type: string,
    listener: (event: RuntimeEvent) => Promise<void> | void,
  ) => {
    (listeners[type] ??= []).push(listener);
  };

  let spaStyleElement: RuntimeElement | null = null;
  const makeTrackedElement = () =>
    makeElement((element) => {
      if (spaStyleElement === element) spaStyleElement = null;
    });
  const bodyAttributes = new Set<string>();
  const rootElement = { __reactRoot: { render() {} } } as unknown as RuntimeElement;
  const document = {
    readyState: "complete",
    title: "",
    body: {
      prepend() {},
      setAttribute(name: string) {
        bodyAttributes.add(name);
      },
      removeAttribute(name: string) {
        bodyAttributes.delete(name);
      },
      appendChild() {},
    },
    head: {
      appendChild(element: RuntimeElement) {
        if (element.id === "veryfront-spa-css") spaStyleElement = element;
      },
    },
    createElement: () => makeTrackedElement(),
    querySelector: () => null,
    querySelectorAll: () => [] as RuntimeElement[],
    getElementById: (id: string) => {
      if (id === "veryfront-hydration-data") {
        return { textContent: hydrationJson } as unknown as RuntimeElement;
      }
      if (id === "root") return rootElement;
      if (id === "veryfront-spa-css") return spaStyleElement;
      return null;
    },
    addEventListener,
  } as unknown as RuntimeDocument;

  let assignedHref: string | undefined;
  let reloadCount = 0;
  const historyCalls: HistoryCall[] = [];

  const window = {
    location: {
      origin: "https://veryfront.test",
      pathname: options.pathname ?? "/",
      search: options.search ?? "",
      hash: "",
      get href(): string {
        return assignedHref ??
          "https://veryfront.test" + this.pathname + this.search + this.hash;
      },
      set href(value: string) {
        assignedHref = value;
      },
      reload() {
        reloadCount++;
      },
    },
    history: {
      pushState(_state: unknown, _unused: string, href: string) {
        historyCalls.push({ method: "push", href });
      },
      replaceState(_state: unknown, _unused: string, href: string) {
        historyCalls.push({ method: "replace", href });
      },
      back() {},
      forward() {},
    },
    addEventListener,
    dispatchEvent: () => true,
    scrollTo() {},
    scrollY: 0,
    __VERYFRONT_DEBUG__: options.debug,
  } as unknown as RuntimeWindow;
  if (options.activeReleaseId) window.__veryfrontReleaseId = options.activeReleaseId;

  let nextPageData: PageDataPayload = {
    pagePath: "page",
    params: {},
    ...(options.hydrationDependencyPinningCacheKey !== undefined
      ? { dependencyPinningCacheKey: options.hydrationDependencyPinningCacheKey }
      : {}),
  };

  const fetchCalls: FetchCall[] = [];
  const fetchStub = (url: string, options_?: RuntimeFetchInit): Promise<RuntimeResponse> => {
    const init = options_ ?? {};
    fetchCalls.push({ url, options: init });
    if (options.fetchImpl) return options.fetchImpl(url, init);

    return Promise.resolve({
      ok: true,
      status: 200,
      url: "/_veryfront/page-data/page.json",
      headers: { get: () => null },
      json: () => Promise.resolve(nextPageData),
    } as RuntimeResponse);
  };

  const RouterProvider = () => ({});
  const PageContextProvider = () => ({});

  let renderedRouterParams: Record<string, string> | null = null;
  let renderedPageParams: Record<string, string> | null = null;
  const React = {
    createElement: (type: unknown, props?: Record<string, unknown> | null) => {
      if (type === RouterProvider && props?.router) {
        renderedRouterParams = { ...(props.router as ClientRouter).params };
      } else if (props && "params" in props && renderedPageParams === null) {
        renderedPageParams = { ...(props.params as Record<string, string>) };
      }
      return {};
    },
    isValidElement: () => false,
    Children: { toArray: () => [] },
    Component: class {} as unknown as ReactLike["Component"],
  } as unknown as ReactLike;

  const store: FakeNavigationStore = {
    navigator: null,
    assignFallbackCount: 0,
    notifications: 0,
    subscribe: () => () => {},
    getHref: () => "/",
    notify: () => {
      store.notifications++;
    },
    navigate(href, navigateOptions) {
      if (store.navigator) return store.navigator(href, navigateOptions);
      store.assignFallbackCount++;
      return Promise.resolve();
    },
    setNavigator(next) {
      store.navigator = next;
      let active = true;
      return () => {
        if (!active || store.navigator !== next) return;
        active = false;
        store.navigator = null;
      };
    },
  };

  const env: HydrationRuntimeEnv = {
    window,
    document,
    fetch: fetchStub,
    React,
    RouterProvider,
    PageContextProvider,
    createRoot: () => ({ render() {} }),
    importModule: options.importModuleImpl ?? (() => Promise.resolve({} as ModuleNamespace)),
    useRouterFromModule: () => ({}),
    // Timers are stubbed out so no navigation leaves a live timer behind, the
    // same way the old `new Function` harness passed `() => 0`.
    setTimeout: options.setTimeoutImpl ?? (() => 0),
    clearTimeout: options.clearTimeoutImpl ?? (() => {}),
  };

  const logging = createLogging(window);
  const initialHydrationData = readInitialHydrationData(document);
  const snapshotModules = createSnapshotModuleImporter({
    importModule: env.importModule,
    fetchModule: env.fetch,
    reloadDocument: () => {
      reloadCount++;
    },
    recoveryState: {},
  });

  const moduleResolutionCalls: ModuleResolutionCall[] = [];
  const loadComponent = (path: string) =>
    options.loadComponentImpl?.(path) ?? Promise.resolve(() => null);
  const componentLoader = {
    loadComponent,
    pathToModuleUrl: (path: string) => "/_vf_modules/" + path,
    resolveHydrationModuleUrl(
      path: string,
      preferRscModule: boolean,
      studioEmbed: boolean,
      moduleData: PageDataPayload,
      releaseAssetModules: Record<string, string> | null,
      releaseId: string | null,
    ) {
      moduleResolutionCalls.push({
        path,
        preferRscModule,
        studioEmbed,
        releaseAssetModules,
        releaseId,
      });
      if (
        !studioEmbed && releaseAssetModules &&
        Object.prototype.hasOwnProperty.call(releaseAssetModules, path)
      ) {
        return releaseAssetModules[path] as string;
      }
      if (preferRscModule) {
        let url = "/_veryfront/rsc/module?rel=" + encodeURIComponent(path);
        if (typeof moduleData.dependencyPinningCacheKey === "string") {
          url += "&pins=" + encodeURIComponent(moduleData.dependencyPinningCacheKey);
        }
        return url;
      }
      return path;
    },
    async loadComponentFromUrl(
      path: string,
      moduleUrl: string,
      loadOptions: { allowDocumentReload?: boolean } = {},
    ) {
      if (!options.importModuleImpl) return await loadComponent(path);
      const module = await snapshotModules.importSnapshotBoundModule(
        moduleUrl,
        loadOptions.allowDocumentReload !== false,
      );
      return module.MDXLayout || module.MainLayout || module.default || module;
    },
    clearComponentCache: () => {},
    setStudioEmbed: () => {},
    setReleaseId: () => {},
    setReleaseAssetModules: () => {},
    setHMRRefreshTimestamp: () => {},
  } as unknown as ComponentLoader;

  const runtime = createRouterRuntime({
    env,
    logging,
    routeTiming: createRouteTimingRecorder(window, logging),
    componentLoader,
    snapshotModules,
    initialHydrationData,
    documentDependencyPinningCacheKey: readDocumentDependencyPinningCacheKey(initialHydrationData),
    getNavigationStore: () => store,
    navigationStoreUsesRegistryFallback: options.routerRuntimeExportsNavigationStore === false,
  });

  return {
    runtime,
    router: runtime.router,
    window,
    listeners,
    fetchCalls,
    historyCalls,
    store,
    moduleResolutionCalls,
    setNextPageData: (data) => {
      nextPageData = data;
    },
    renderedRouterParams: () => renderedRouterParams,
    renderedPageParams: () => renderedPageParams,
    routeCss: () => spaStyleElement?.textContent ?? null,
    assignedHref: () => assignedHref,
    bodyBusy: () => bodyAttributes.has("aria-busy"),
    reloads: () => reloadCount,
  };
}

function pageDataResponse(
  path = "page",
  pageData: PageDataPayload = { pagePath: path, params: {} },
): RuntimeResponse {
  return {
    ok: true,
    status: 200,
    url: "/_veryfront/page-data/" + path + ".json",
    headers: { get: () => null },
    json: () => Promise.resolve(pageData),
  } as RuntimeResponse;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function flushMicrotasks(): Promise<void> {
  return Promise.resolve().then(() => {});
}

async function flushUntil(check: () => boolean): Promise<void> {
  for (let i = 0; i < 10; i++) {
    if (check()) return;
    await flushMicrotasks();
  }
}

describe("hydration-script-builder/runtime/router", () => {
  it("seeds router params from hydration data, joining catch-all segments", () => {
    const { router } = createRouterHarness({
      pathname: "/docs/guides/intro",
      hydrationParams: { slug: ["guides", "intro"], lang: "en" },
    });

    assertEquals(router.params, { slug: "guides/intro", lang: "en" });
  });

  it("publishes the router and the hydration signals on window", () => {
    const harness = createRouterHarness();

    assertEquals(harness.window.__veryfrontRouter, harness.router);
    assertEquals(typeof harness.window.__veryfrontHydrationComplete, "function");
    assertEquals(typeof harness.window.__veryfrontHydrationFailed, "function");
    assertEquals(typeof harness.window.useRouter, "function");
  });

  it("preserves route queries and binds page-data requests to the document snapshot", async () => {
    const harness = createRouterHarness({
      hydrationDependencyPinningCacheKey: "on:snapshot-a",
    });
    harness.window.__veryfrontHydrationComplete?.();

    await harness.runtime.navigateSPA("/search?pins=customer-value&q=one");

    assertEquals(
      harness.fetchCalls[0]?.url,
      "/_veryfront/page-data/search.json?pins=customer-value&q=one",
    );
    assertEquals(harness.fetchCalls[0]?.options.headers, {
      "X-Veryfront-Navigation": "spa",
      "X-Veryfront-Dependency-Pins": "on:snapshot-a",
    });
  });

  it("falls back to a document navigation when page data returns another snapshot", async () => {
    const harness = createRouterHarness({
      hydrationDependencyPinningCacheKey: "on:snapshot-a",
    });
    harness.window.__veryfrontHydrationComplete?.();
    harness.setNextPageData({
      pagePath: "page",
      params: {},
      dependencyPinningCacheKey: "on:snapshot-b",
    });

    await harness.runtime.navigateSPA("/target");

    assertEquals(harness.window.location.href, "https://veryfront.test/target");
    assertEquals(harness.renderedRouterParams(), null);
  });

  it("falls back to a document navigation when the pinned snapshot is unavailable", async () => {
    const harness = createRouterHarness({
      hydrationDependencyPinningCacheKey: "on:snapshot-a",
      fetchImpl: () =>
        Promise.resolve({
          ok: false,
          status: 409,
          url: "/_veryfront/page-data/target.json?pins=on%3Asnapshot-a",
          headers: { get: () => null },
          json: () => Promise.resolve({}),
        } as RuntimeResponse),
    });
    harness.window.__veryfrontHydrationComplete?.();

    await harness.runtime.navigateSPA("/target");

    assertEquals(harness.window.location.href, "https://veryfront.test/target");
    assertEquals(harness.renderedRouterParams(), null);
  });

  it("replaces stale params with new page data on SPA navigation", async () => {
    const harness = createRouterHarness({
      pathname: "/posts/42",
      hydrationParams: { id: "42" },
    });
    harness.window.__veryfrontHydrationComplete?.();

    harness.setNextPageData({ pagePath: "page", params: { id: "99" } });
    harness.window.location.pathname = "/posts/99";
    await harness.runtime.navigateSPA("/posts/99");

    assertEquals(harness.router.params, { id: "99" });
    assertEquals(harness.router.pathname, "/posts/99");
    // The new page must render with the fresh params — not the previous
    // route's — which only holds if params are updated before render.
    assertEquals(harness.renderedRouterParams(), { id: "99" });
  });

  it("normalizes catch-all params for both router and page props on SPA nav", async () => {
    const harness = createRouterHarness({ pathname: "/", hydrationParams: {} });
    harness.window.__veryfrontHydrationComplete?.();

    // Page data carries a raw catch-all array, as route matching produces it.
    harness.setNextPageData({ pagePath: "page", params: { slug: ["guides", "intro"] } });
    await harness.runtime.navigateSPA("/docs/guides/intro");

    // Both the router snapshot and the page component's `params` prop must be
    // joined strings so client and server render identically (#2742).
    assertEquals(harness.router.params, { slug: "guides/intro" });
    assertEquals(harness.renderedRouterParams(), { slug: "guides/intro" });
    assertEquals(harness.renderedPageParams(), { slug: "guides/intro" });
  });

  it("clears params when navigating to a static route", async () => {
    const harness = createRouterHarness({
      pathname: "/posts/42",
      hydrationParams: { id: "42" },
    });
    harness.window.__veryfrontHydrationComplete?.();

    harness.setNextPageData({ pagePath: "page", params: {} });
    await harness.runtime.navigateSPA("/about");

    assertEquals(harness.router.params, {});
    assertEquals(harness.renderedRouterParams(), {});
  });

  it("refreshes params from history state on popstate navigation", async () => {
    const harness = createRouterHarness({
      pathname: "/posts/42",
      hydrationParams: { id: "42" },
    });
    harness.window.__veryfrontHydrationComplete?.();

    harness.window.location.pathname = "/posts/7";
    const popstate = harness.listeners.popstate?.[0];
    if (!popstate) throw new Error("popstate handler was not registered");
    await popstate(
      { state: { pageData: { pagePath: "page", params: { id: "7" } } } } as unknown as RuntimeEvent,
    );

    assertEquals(harness.router.params, { id: "7" });
    assertEquals(harness.renderedRouterParams(), { id: "7" });
  });

  it("rejects history state from another dependency snapshot without refetching", async () => {
    const harness = createRouterHarness({
      pathname: "/current",
      hydrationDependencyPinningCacheKey: "on:snapshot-a",
    });
    harness.window.__veryfrontHydrationComplete?.();
    harness.window.location.pathname = "/stale-history";
    const popstate = harness.listeners.popstate?.[0];
    if (!popstate) throw new Error("popstate handler was not registered");

    await popstate({
      state: {
        pageData: {
          pagePath: "page",
          params: { owner: "stale" },
          dependencyPinningCacheKey: "on:snapshot-b",
        },
      },
    } as unknown as RuntimeEvent);

    assertEquals(harness.fetchCalls, []);
    assertEquals(harness.renderedPageParams(), null);
    assertEquals(harness.historyCalls, []);
    assertEquals(
      harness.assignedHref(),
      "https://veryfront.test/stale-history",
    );
  });

  it("keeps query strings out of router pathnames and notifies subscribers after commit", async () => {
    const harness = createRouterHarness();
    harness.window.__veryfrontHydrationComplete?.();

    await harness.runtime.navigateSPA("/catalog?sort=rating&page=2");

    assertEquals(
      harness.fetchCalls[0]?.url,
      "/_veryfront/page-data/catalog.json?sort=rating&page=2",
    );
    assertEquals(harness.router.path, "/catalog");
    assertEquals(harness.router.pathname, "/catalog");
    assertEquals(harness.router.query, { sort: "rating", page: "2" });
    assertEquals(harness.historyCalls, [{
      method: "push",
      href: "/catalog?sort=rating&page=2",
    }]);
    assertEquals(harness.store.notifications, 1);
  });

  it("lets only the latest concurrent navigation commit", async () => {
    const requests = new Map<string, ReturnType<typeof deferred<RuntimeResponse>>>();
    const harness = createRouterHarness({
      fetchImpl: (url) => {
        const request = deferred<RuntimeResponse>();
        requests.set(url, request);
        return request.promise;
      },
    });
    harness.window.__veryfrontHydrationComplete?.();

    const firstNavigation = harness.runtime.navigateSPA("/first");
    await flushUntil(() => requests.has("/_veryfront/page-data/first.json"));
    const secondNavigation = harness.runtime.navigateSPA("/second");
    await flushUntil(() => requests.has("/_veryfront/page-data/second.json"));

    requests.get("/_veryfront/page-data/second.json")?.resolve(
      pageDataResponse("page-b", {
        pagePath: "page-b",
        params: { owner: "second" },
      }),
    );
    requests.get("/_veryfront/page-data/first.json")?.resolve(
      pageDataResponse("page-a", {
        pagePath: "page-a",
        params: { owner: "first" },
      }),
    );
    await Promise.all([firstNavigation, secondNavigation]);

    assertEquals(harness.fetchCalls.map((call) => call.url), [
      "/_veryfront/page-data/first.json",
      "/_veryfront/page-data/second.json",
    ]);
    assertEquals(harness.router.pathname, "/second");
    assertEquals(harness.router.params, { owner: "second" });
    assertEquals(harness.renderedPageParams(), { owner: "second" });
    assertEquals(harness.historyCalls, [{ method: "push", href: "/second" }]);
    assertEquals(harness.store.notifications, 1);
    assertEquals(harness.bodyBusy(), false);
  });

  it("prevents a superseded delayed module load from overwriting the latest page", async () => {
    const firstComponent = deferred<unknown>();
    const loadedPaths: string[] = [];
    const harness = createRouterHarness({
      fetchImpl: (url) => {
        const first = url.endsWith("/first.json");
        return Promise.resolve(pageDataResponse(first ? "page-a" : "page-b", {
          pagePath: first ? "page-a" : "page-b",
          params: { owner: first ? "first" : "second" },
        }));
      },
      loadComponentImpl: (path) => {
        loadedPaths.push(path);
        return path === "page-a" ? firstComponent.promise : Promise.resolve(() => null);
      },
    });
    harness.window.__veryfrontHydrationComplete?.();

    const firstNavigation = harness.runtime.navigateSPA("/first");
    await flushUntil(() => loadedPaths.includes("page-a"));
    const secondNavigation = harness.runtime.navigateSPA("/second");
    await secondNavigation;
    firstComponent.resolve(() => null);
    await firstNavigation;

    assertEquals(harness.router.pathname, "/second");
    assertEquals(harness.renderedPageParams(), { owner: "second" });
    assertEquals(harness.historyCalls, [{ method: "push", href: "/second" }]);
    assertEquals(harness.store.notifications, 1);
  });

  it("replaces prior route CSS with an authoritative empty string", async () => {
    const harness = createRouterHarness();
    harness.window.__veryfrontHydrationComplete?.();

    harness.setNextPageData({ pagePath: "page", params: {}, css: ".styled{color:red}" });
    await harness.runtime.navigateSPA("/styled");
    assertEquals(harness.routeCss(), ".styled{color:red}");

    harness.setNextPageData({ pagePath: "page", params: {}, css: "" });
    await harness.runtime.navigateSPA("/unstyled");
    assertEquals(harness.routeCss(), "");
  });

  it("limits page-data prefetches to two active requests", async () => {
    const pendingResolvers: Array<(value: RuntimeResponse) => void> = [];
    const harness = createRouterHarness({
      fetchImpl: () =>
        new Promise<RuntimeResponse>((resolve) => {
          pendingResolvers.push(resolve);
        }),
    });

    harness.router.prefetch("/a");
    harness.router.prefetch("/b");
    harness.router.prefetch("/c");
    harness.router.prefetch("/d");

    assertEquals(harness.fetchCalls.map((call) => call.url), [
      "/_veryfront/page-data/a.json",
      "/_veryfront/page-data/b.json",
    ]);

    const resolveFirst = pendingResolvers[0];
    if (!resolveFirst) throw new Error("first prefetch did not start");
    resolveFirst(pageDataResponse("a"));
    await flushUntil(() => harness.fetchCalls.length === 3);

    assertEquals(harness.fetchCalls.map((call) => call.url), [
      "/_veryfront/page-data/a.json",
      "/_veryfront/page-data/b.json",
      "/_veryfront/page-data/c.json",
    ]);
  });

  it("marks speculative page-data prefetches and does not retry them", async () => {
    const harness = createRouterHarness({
      fetchImpl: () =>
        Promise.resolve({
          ok: false,
          status: 500,
          url: "/_veryfront/page-data/fail.json",
          headers: { get: () => null },
          json: () => Promise.resolve({}),
        } as RuntimeResponse),
    });

    harness.router.prefetch("/fail");
    await flushMicrotasks();
    await flushMicrotasks();

    assertEquals(harness.fetchCalls.length, 1);
    const call = harness.fetchCalls[0];
    if (!call) throw new Error("prefetch fetch did not start");
    assertEquals(call.options.headers, { "X-Veryfront-Prefetch": "1" });
  });

  it("keeps speculative module resolution scoped to the prefetched release", async () => {
    const releaseAssetModules = {
      "app/page.tsx": "/_vf/assets/" + "a".repeat(64) + ".js",
    };
    const harness = createRouterHarness({
      activeReleaseId: "release-1",
      fetchImpl: () =>
        Promise.resolve(pageDataResponse("next", {
          pagePath: "app/page.tsx",
          params: {},
          isolatedClientPage: true,
          releaseId: "release-1",
          releaseAssetModules,
        })),
    });

    harness.router.prefetch("/next");
    await flushUntil(() => harness.moduleResolutionCalls.length === 1);

    assertEquals(harness.moduleResolutionCalls, [{
      path: "app/page.tsx",
      preferRscModule: true,
      studioEmbed: false,
      releaseAssetModules,
      releaseId: "release-1",
    }]);
  });

  it("does not treat different healthy production pod starts as new builds", async () => {
    const harness = createRouterHarness({
      hydrationBuildVersion: {
        framework: "1.0.0",
        serverStart: 1,
        projectUpdated: "2026-07-27T17:00:00.000Z",
      },
      hydrationDev: false,
      fetchImpl: (url) =>
        Promise.resolve(pageDataResponse(url.includes("/one.json") ? "one" : "two", {
          pagePath: "page",
          params: {},
          buildVersion: {
            framework: "1.0.0",
            serverStart: url.includes("/one.json") ? 2 : 3,
            projectUpdated: "2026-07-27T17:00:00.000Z",
          },
        })),
    });
    harness.window.__veryfrontHydrationComplete?.();

    await harness.runtime.navigateSPA("/one");
    await harness.runtime.navigateSPA("/two");

    assertEquals(harness.assignedHref(), undefined);
    assertEquals(harness.router.pathname, "/two");
    assertEquals(harness.historyCalls, [
      { method: "push", href: "/one" },
      { method: "push", href: "/two" },
    ]);
  });

  it("reloads when cached speculative data belongs to a restarted dev server", async () => {
    const harness = createRouterHarness({
      hydrationBuildVersion: { framework: "1.0.0", serverStart: 1 },
      hydrationDev: true,
      fetchImpl: () =>
        Promise.resolve(pageDataResponse("stale", {
          pagePath: "page",
          params: {},
          buildVersion: { framework: "1.0.0", serverStart: 2 },
        })),
    });
    harness.window.__veryfrontHydrationComplete?.();

    harness.router.prefetch("/stale");
    await flushUntil(() => harness.fetchCalls.length === 1);
    for (let index = 0; index < 10; index++) await flushMicrotasks();
    await harness.runtime.navigateSPA("/stale");

    assertEquals(harness.fetchCalls.length, 1);
    assertEquals(harness.assignedHref(), "https://veryfront.test/stale");
    assertEquals(harness.historyCalls, []);
    assertEquals(harness.router.pathname, "/");
  });

  it("does not reload the active document for a speculative module snapshot conflict", async () => {
    const harness = createRouterHarness({
      hydrationDependencyPinningCacheKey: "on:snapshot-a",
      importModuleImpl: () => Promise.reject(new Error("module import failed")),
      fetchImpl: (url) => {
        if (url.startsWith("/_veryfront/page-data/")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            url,
            headers: { get: () => null },
            json: () =>
              Promise.resolve({
                pagePath: "app/page.tsx",
                params: {},
                isolatedClientPage: true,
                dependencyPinningCacheKey: "on:snapshot-a",
              }),
          } as RuntimeResponse);
        }

        return Promise.resolve(
          new Response("Unknown dependency snapshot", {
            status: 409,
          }) as unknown as RuntimeResponse,
        );
      },
    });

    harness.router.prefetch("/target");
    await flushUntil(() => harness.fetchCalls.length >= 2);

    assertEquals(harness.fetchCalls.map((call) => call.url), [
      "/_veryfront/page-data/target.json",
      "/_veryfront/rsc/module?rel=app%2Fpage.tsx&pins=on%3Asnapshot-a",
    ]);
    assertEquals(harness.reloads(), 0);
  });

  it("allows a failed speculative prefetch to be requested again later", async () => {
    const harness: RouterHarness = createRouterHarness({
      fetchImpl: () => {
        if (harness.fetchCalls.length === 1) {
          return Promise.resolve({
            ok: false,
            status: 500,
            url: "/_veryfront/page-data/retry.json",
            headers: { get: () => null },
            json: () => Promise.resolve({}),
          } as RuntimeResponse);
        }

        return Promise.resolve(pageDataResponse("retry"));
      },
    });

    harness.router.prefetch("/retry");

    for (let i = 0; i < 10 && harness.fetchCalls.length < 2; i++) {
      await flushMicrotasks();
      harness.router.prefetch("/retry");
    }

    assertEquals(harness.fetchCalls.map((call) => call.url), [
      "/_veryfront/page-data/retry.json",
      "/_veryfront/page-data/retry.json",
    ]);
  });

  it("aborts active speculative prefetches and starts foreground navigation independently", async () => {
    const abortedPrefetches: string[] = [];
    const debugLogs: unknown[][] = [];
    const errorLogs: unknown[][] = [];
    const originalConsoleLog = console.log;
    const originalConsoleError = console.error;
    console.log = (...args: unknown[]) => {
      debugLogs.push(args);
    };
    console.error = (...args: unknown[]) => {
      errorLogs.push(args);
    };

    const harness = createRouterHarness({
      debug: true,
      fetchImpl: (url, options) => {
        if (options.headers?.["X-Veryfront-Prefetch"] === "1") {
          return new Promise<RuntimeResponse>((_, reject) => {
            options.signal?.addEventListener("abort", () => {
              abortedPrefetches.push(url);
              reject(new DOMException("Aborted", "AbortError"));
            });
          });
        }

        return Promise.resolve(pageDataResponse("target"));
      },
    });

    try {
      harness.window.__veryfrontHydrationComplete?.();

      harness.router.prefetch("/target");
      harness.router.prefetch("/other");
      harness.router.prefetch("/queued");
      assertEquals(harness.fetchCalls.length, 2);

      await harness.runtime.navigateSPA("/target");

      assertEquals(abortedPrefetches.sort(), [
        "/_veryfront/page-data/other.json",
        "/_veryfront/page-data/target.json",
      ]);
      assertEquals(
        debugLogs.some((args) => String(args.join(" ")).includes("Page data prefetch failed")),
        false,
      );
      assertEquals(errorLogs, []);
      const navigationCall = harness.fetchCalls[2];
      if (!navigationCall) throw new Error("foreground navigation fetch did not start");
      assertEquals(navigationCall.url, "/_veryfront/page-data/target.json");
      assertEquals(navigationCall.options.headers, { "X-Veryfront-Navigation": "spa" });
      assertEquals(harness.router.pathname, "/target");
    } finally {
      console.log = originalConsoleLog;
      console.error = originalConsoleError;
    }
  });

  // Finding #7: useRouter().push()/replace() must perform SPA navigation, not a
  // full document reload. `useRouter()` routes push/replace/navigate through the
  // shared navigation store's `navigate`, which delegates to whatever navigator
  // has been registered via `setNavigator` — or falls back to `location.assign`
  // (a full reload) when none is. This runtime owns the real SPA navigator, so
  // it must register it against the shared store.
  describe("push SPA navigator (finding #7)", () => {
    it("registers the SPA navigator against the shared navigation store", () => {
      const harness = createRouterHarness();
      assertEquals(typeof harness.store.navigator, "function");
    });

    it("routes store.navigate({history:'push'}) through SPA navigation, not a full reload", async () => {
      const harness = createRouterHarness();
      harness.window.__veryfrontHydrationComplete?.();
      harness.setNextPageData({ pagePath: "page", params: {} });
      harness.window.location.pathname = "/next";

      // This is exactly what useRouter().push('/next') does in the react runtime.
      await harness.store.navigate("/next", { history: "push" });

      assertEquals(harness.store.assignFallbackCount, 0);
      assertEquals(harness.router.pathname, "/next");
      assertEquals(harness.historyCalls, [{ method: "push", href: "/next" }]);
    });

    it("routes store.navigate({history:'replace'}) through SPA navigation, not a full reload", async () => {
      const harness = createRouterHarness();
      harness.window.__veryfrontHydrationComplete?.();
      harness.setNextPageData({ pagePath: "page", params: {} });
      harness.window.location.pathname = "/replaced";

      await harness.store.navigate("/replaced", { history: "replace" });

      assertEquals(harness.store.assignFallbackCount, 0);
      assertEquals(harness.router.pathname, "/replaced");
      assertEquals(harness.historyCalls, [{ method: "replace", href: "/replaced" }]);
    });

    it("logs the registry fallback when the router asset predates getNavigationStore", () => {
      const logs: unknown[][] = [];
      const originalConsoleLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args);
      };
      try {
        createRouterHarness({ debug: true, routerRuntimeExportsNavigationStore: false });
        assertEquals(
          logs.some((args) =>
            String(args.join(" ")).includes("Router runtime does not export getNavigationStore")
          ),
          true,
        );
      } finally {
        console.log = originalConsoleLog;
      }
    });
  });

  describe("navigation redirects", () => {
    it("follows an http(s) redirect destination with a document navigation", async () => {
      const harness = createRouterHarness();
      harness.window.__veryfrontHydrationComplete?.();
      harness.setNextPageData({ redirect: { destination: "/moved" } });

      await harness.runtime.navigateSPA("/from");

      assertEquals(harness.window.location.href, "https://veryfront.test/moved");
    });

    it("refuses to follow a javascript: redirect destination", async () => {
      const harness = createRouterHarness();
      harness.window.__veryfrontHydrationComplete?.();
      harness.setNextPageData({
        redirect: { destination: "javascript:alert(1)" },
        pagePath: "page",
        params: {},
      });

      await harness.runtime.navigateSPA("/from");

      assertEquals(harness.window.location.href.includes("javascript:"), false);
    });
  });

  // Every path that leaves the SPA resolves and scheme-checks its target first.
  // Assigning a javascript: URL to location.href would execute it.
  describe("unsafe document navigation", () => {
    it("reloads instead of following an unsafe target when navigation fails", async () => {
      const harness = createRouterHarness({
        // 404 rather than a rejection: a rejection retries through sleep(),
        // and the harness stubs setTimeout so the retry would never resolve.
        fetchImpl: (url) =>
          Promise.resolve({
            ok: false,
            status: 404,
            url,
            headers: { get: () => null },
            json: () => Promise.resolve({}),
          } as RuntimeResponse),
      });
      harness.window.__veryfrontHydrationComplete?.();

      await harness.runtime.navigateSPA("javascript:alert(1)");

      assertEquals(harness.reloads(), 1);
      assertEquals(harness.window.location.href.includes("javascript:"), false);
    });

    // The build-version-mismatch path (handlePageDataVersionMismatch) routes
    // through the same navigateDocument helper, but it deliberately returns a
    // never-resolving promise so the SPA stalls while the document navigates
    // away. Any test that reaches it leaves a pending promise, so that branch
    // is covered by resolveDocumentNavigationUrl's own tests plus the shared
    // call site rather than by an integration test that fights the sanitizer.

    it("still follows a safe target on the same failure path", async () => {
      const harness = createRouterHarness({
        // 404 rather than a rejection: a rejection retries through sleep(),
        // and the harness stubs setTimeout so the retry would never resolve.
        fetchImpl: (url) =>
          Promise.resolve({
            ok: false,
            status: 404,
            url,
            headers: { get: () => null },
            json: () => Promise.resolve({}),
          } as RuntimeResponse),
      });
      harness.window.__veryfrontHydrationComplete?.();

      await harness.runtime.navigateSPA("/still-safe");

      assertEquals(harness.window.location.href, "https://veryfront.test/still-safe");
      assertEquals(harness.reloads(), 0);
    });
  });

  describe("server-layout routes", () => {
    it("falls back to a document navigation when the route needs the server layout", async () => {
      const harness = createRouterHarness();
      harness.window.__veryfrontHydrationComplete?.();
      harness.setNextPageData({ pagePath: "page", requiresFullDocumentNavigation: true });

      await harness.runtime.navigateSPA("/server-only");

      assertEquals(harness.window.location.href, "https://veryfront.test/server-only");
    });
  });
});
