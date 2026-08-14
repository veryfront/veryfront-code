import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
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
}

interface RouterHarness {
  runtime: RouterRuntime;
  router: ClientRouter;
  window: RuntimeWindow;
  listeners: Record<string, Array<(event: RuntimeEvent) => Promise<void> | void>>;
  fetchCalls: FetchCall[];
  historyCalls: HistoryCall[];
  store: FakeNavigationStore;
  document: RuntimeDocument;
  headElements: RuntimeElement[];
  setNextPageData(data: PageDataPayload): void;
  /** router.params at the moment RouterProvider was built — what the new page renders with. */
  renderedRouterParams(): Record<string, string> | null;
  /** The `params` prop handed to the page component; must be normalized. */
  renderedPageParams(): Record<string, string> | null;
  reloads(): number;
}

interface HarnessOptions {
  pathname?: string;
  search?: string;
  hydrationParams?: Record<string, string | string[]>;
  hydrationDependencyPinningCacheKey?: string;
  fetchImpl?: (url: string, options: RuntimeFetchInit) => Promise<RuntimeResponse>;
  importModuleImpl?: (moduleUrl: string) => Promise<ModuleNamespace>;
  debug?: boolean;
  routerRuntimeExportsNavigationStore?: boolean;
}

type TestRuntimeElement = RuntimeElement & {
  readonly tagName: string;
  readonly attributes: Array<{ name: string; value: string }>;
  parentElement: TestRuntimeElement | null;
  children: TestRuntimeElement[];
  querySelector(selector: string): TestRuntimeElement | null;
  querySelectorAll(selector: string): TestRuntimeElement[];
  setRemoveHandler(handler: () => void): void;
};

function matchesSelector(element: TestRuntimeElement, selector: string): boolean {
  return selector.split(",").some((rawPart) => {
    const part = rawPart.trim();
    const tag = part.match(/^[a-z]+/i)?.[0]?.toUpperCase();
    if (tag && element.tagName !== tag) return false;
    const id = part.match(/#([A-Za-z0-9_-]+)/)?.[1];
    if (id && element.id !== id) return false;
    for (const match of part.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)) {
      const name = match[1] ?? "";
      const expected = match[2];
      if (expected === undefined) {
        if (!element.hasAttribute(name)) return false;
      } else if (element.getAttribute(name) !== expected) {
        return false;
      }
    }
    return Boolean(tag || id || part.includes("["));
  });
}

function makeElement(tagName = "div"): TestRuntimeElement {
  const attributes = new Map<string, string>();
  let removeHandler = () => {};
  const element: TestRuntimeElement = {
    style: {},
    id: "",
    textContent: "",
    innerHTML: "",
    target: "",
    tagName: tagName.toUpperCase(),
    parentElement: null,
    children: [] as TestRuntimeElement[],
    get attributes() {
      return [...attributes].map(([name, value]) => ({ name, value }));
    },
    setAttribute(name: string, value: string) {
      attributes.set(name.toLowerCase(), value);
      if (name.toLowerCase() === "id") element.id = value;
    },
    getAttribute(name: string) {
      if (name.toLowerCase() === "id" && element.id) return element.id;
      return attributes.get(name.toLowerCase()) ?? null;
    },
    hasAttribute(name: string) {
      return attributes.has(name.toLowerCase());
    },
    removeAttribute(name: string) {
      attributes.delete(name.toLowerCase());
    },
    prepend() {},
    remove() {
      removeHandler();
    },
    appendChild(node: unknown) {
      if (!(node && typeof node === "object" && "tagName" in node)) return;
      element.children.push(node as TestRuntimeElement);
    },
    contains: () => false,
    closest: () => null,
    scrollIntoView() {},
    querySelector(selector: string) {
      return element.children.find((child) => matchesSelector(child, selector)) ?? null;
    },
    querySelectorAll(selector: string) {
      return element.children.filter((child) => matchesSelector(child, selector));
    },
    setRemoveHandler(handler: () => void) {
      removeHandler = handler;
    },
  };
  return element;
}

function createRouterHarness(options: HarnessOptions = {}): RouterHarness {
  const hydrationJson = JSON.stringify({
    params: options.hydrationParams ?? {},
    ...(options.hydrationDependencyPinningCacheKey
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

  const rootElement = { __reactRoot: { render() {} } } as unknown as RuntimeElement;
  const hydrationElement = makeElement("script");
  hydrationElement.id = "veryfront-hydration-data";
  hydrationElement.textContent = hydrationJson;
  hydrationElement.setAttribute("type", "application/json");
  const bodyElement = makeElement("body");
  bodyElement.firstElementChild = hydrationElement;
  const headElement = makeElement("head");
  const headElements = headElement.children;
  headElement.appendChild = (node: unknown) => {
    const child = node as TestRuntimeElement;
    child.parentElement = headElement;
    child.setRemoveHandler(() => {
      const index = headElements.indexOf(child);
      if (index !== -1) headElements.splice(index, 1);
      child.parentElement = null;
    });
    headElements.push(child);
  };
  let fallbackTitle = "";
  const document = {
    readyState: "complete",
    get title() {
      return headElement.querySelector("title")?.textContent ?? fallbackTitle;
    },
    set title(value: string) {
      fallbackTitle = value;
    },
    body: bodyElement,
    head: headElement,
    createElement: (tagName: string) => makeElement(tagName),
    querySelector: (selector: string) => headElement.querySelector(selector),
    querySelectorAll: (selector: string) =>
      selector === '[id="veryfront-hydration-data"]'
        ? [hydrationElement]
        : headElement.querySelectorAll(selector),
    getElementById: (id: string) => {
      if (id === "veryfront-hydration-data") {
        return hydrationElement;
      }
      if (id === "root") return rootElement;
      return headElements.find((element) => element.id === id) ?? null;
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
      get href(): string {
        return assignedHref ?? "https://veryfront.test" + this.pathname + this.search;
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

  let nextPageData: PageDataPayload = {
    pagePath: "page",
    params: {},
    ...(options.hydrationDependencyPinningCacheKey
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
    subscribe: () => () => {},
    getHref: () => "/",
    notify: () => {},
    navigate(href, navigateOptions) {
      if (store.navigator) return store.navigator(href, navigateOptions);
      store.assignFallbackCount++;
      return Promise.resolve();
    },
    setNavigator(next) {
      store.navigator = next;
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
    setTimeout: () => 0,
    clearTimeout: () => {},
  };

  const logging = createLogging(window);
  const initialHydrationData = readInitialHydrationData(document);

  const componentLoader = {
    loadComponent: () => Promise.resolve(() => null),
    pathToModuleUrl: (path: string) => "/_vf_modules/" + path,
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
    snapshotModules: createSnapshotModuleImporter({
      importModule: env.importModule,
      fetchModule: env.fetch,
      reloadDocument: () => {
        reloadCount++;
      },
      recoveryState: {},
    }),
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
    document,
    headElements,
    setNextPageData: (data) => {
      nextPageData = data;
    },
    renderedRouterParams: () => renderedRouterParams,
    renderedPageParams: () => renderedPageParams,
    reloads: () => reloadCount,
  };
}

function pageDataResponse(path = "page"): RuntimeResponse {
  return {
    ok: true,
    status: 200,
    url: "/_veryfront/page-data/" + path + ".json",
    headers: { get: () => null },
    json: () => Promise.resolve({ pagePath: path, params: {} }),
  } as RuntimeResponse;
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

  it("hands app-router metadata through route ownership across navigations", async () => {
    const harness = createRouterHarness();
    const shellTitle = harness.document.createElement("title");
    shellTitle.textContent = "Page A";
    shellTitle.setAttribute("data-vf-shell-head", "true");
    const shellDescription = harness.document.createElement("meta");
    shellDescription.setAttribute("name", "description");
    shellDescription.setAttribute("content", "Page A description");
    shellDescription.setAttribute("data-vf-shell-head", "true");
    const thirdParty = harness.document.createElement("meta");
    thirdParty.id = "third-party-description";
    thirdParty.setAttribute("name", "description");
    thirdParty.setAttribute("content", "Third party");
    harness.document.head.appendChild(shellTitle);
    harness.document.head.appendChild(shellDescription);
    harness.document.head.appendChild(thirdParty);
    harness.window.__veryfrontHydrationComplete?.();

    await harness.runtime.renderPageFromData({
      pagePath: "page-b",
      params: {},
      frontmatter: {
        title: "Page B",
        description: "Page B description",
      },
    }, "/page-b");

    assertEquals(shellTitle.getAttribute("data-vf-shell-head"), "true");
    assertEquals(harness.headElements.includes(shellTitle), false);
    assertEquals(harness.headElements.includes(shellDescription), false);
    assertEquals(
      harness.document.querySelector('title[data-vf-route-head="true"]')?.textContent,
      "Page B",
    );
    assertEquals(
      harness.document.querySelector(
        'meta[data-vf-route-head="true"][name="description"]',
      )?.getAttribute("content"),
      "Page B description",
    );
    assertStrictEquals(harness.document.getElementById("third-party-description"), thirdParty);
    assertEquals(thirdParty.getAttribute("content"), "Third party");

    await harness.runtime.renderPageFromData({
      pagePath: "page-c",
      params: {},
      frontmatter: {},
    }, "/page-c");

    assertEquals(
      harness.document.querySelector('title[data-vf-route-head="true"]')?.textContent,
      "Page B",
    );
    assertEquals(
      [...harness.document.querySelectorAll('meta[data-vf-route-head="true"]')].length,
      0,
    );
    assertStrictEquals(harness.document.getElementById("third-party-description"), thirdParty);
    assertEquals(thirdParty.getAttribute("content"), "Third party");
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

    it("treats the fallback as designed behaviour, not a console error", async () => {
      const errorLogs: unknown[][] = [];
      const originalConsoleError = console.error;
      console.error = (...args: unknown[]) => {
        errorLogs.push(args);
      };

      try {
        const harness = createRouterHarness();
        harness.window.__veryfrontHydrationComplete?.();
        harness.setNextPageData({ pagePath: "page", requiresFullDocumentNavigation: true });

        await harness.runtime.navigateSPA("/server-only");

        assertEquals(
          harness.window.location.href,
          "https://veryfront.test/server-only",
          "fallback must still hand the route to the document loader",
        );
        assertEquals(errorLogs, [], "the designed fallback must not log a console error");
      } finally {
        console.error = originalConsoleError;
      }
    });

    it("leaves the history entry to the document loader instead of pushing one first", async () => {
      const harness = createRouterHarness();
      harness.window.__veryfrontHydrationComplete?.();
      harness.setNextPageData({ pagePath: "page", requiresFullDocumentNavigation: true });

      await harness.runtime.navigateSPA("/server-only");

      assertEquals(
        harness.historyCalls,
        [],
        "pushState before a document navigation duplicates the history entry",
      );
    });

    it("does not refetch a cached server-layout route while leaving the document", async () => {
      const harness = createRouterHarness();
      harness.window.__veryfrontHydrationComplete?.();
      harness.setNextPageData({ pagePath: "page", requiresFullDocumentNavigation: true });

      harness.router.prefetch("/server-only");
      await flushUntil(() => harness.fetchCalls.length === 1);
      // The fetch is recorded synchronously, but the cache is only populated
      // once the stubbed response resolves — drain the microtask queue so the
      // navigation below really starts from a cached payload.
      for (let i = 0; i < 20; i++) await flushMicrotasks();

      await harness.runtime.navigateSPA("/server-only");

      assertEquals(
        harness.window.location.href,
        "https://veryfront.test/server-only",
        "cached flag must still hand the route to the document loader",
      );
      assertEquals(
        harness.fetchCalls.length,
        1,
        "a background refresh of a route we are leaving the document for is wasted work",
      );
    });
  });

  // Cross-cutting invariants of the navigation lifecycle: soft navigations stay
  // inside the document and history mutates exactly once per navigation, while
  // every path that leaves the SPA (redirects, server layouts) hands the
  // history entry to the browser's document loader untouched.
  describe("navigation contract", () => {
    it("completes a soft navigation inside the current document without console errors", async () => {
      const errorLogs: unknown[][] = [];
      const originalConsoleError = console.error;
      console.error = (...args: unknown[]) => {
        errorLogs.push(args);
      };

      try {
        const harness = createRouterHarness();
        harness.window.__veryfrontHydrationComplete?.();
        harness.setNextPageData({ pagePath: "page", params: {} });

        await harness.runtime.navigateSPA("/next");

        assertEquals(harness.router.pathname, "/next", "the SPA router must own the route");
        assertEquals(
          harness.historyCalls,
          [{ method: "push", href: "/next" }],
          "one soft navigation must mutate history exactly once",
        );
        assertEquals(harness.reloads(), 0, "a soft navigation must not reload the document");
        assertEquals(
          harness.window.location.href,
          "https://veryfront.test/",
          "a soft navigation must not tear down the document",
        );
        assertEquals(errorLogs, [], "a successful navigation must stay silent on console.error");
      } finally {
        console.error = originalConsoleError;
      }
    });

    it("records a replace instead of a push when requested", async () => {
      const harness = createRouterHarness();
      harness.window.__veryfrontHydrationComplete?.();
      harness.setNextPageData({ pagePath: "page", params: {} });

      await harness.runtime.navigateSPA("/swapped", "replace");

      assertEquals(
        harness.historyCalls,
        [{ method: "replace", href: "/swapped" }],
        "replace-style navigation must not grow the history stack",
      );
    });

    it("renders from prefetched page data even when the network refresh hangs", async () => {
      const harness = createRouterHarness({
        fetchImpl: (_url, options) => {
          if (options.headers?.["X-Veryfront-Prefetch"] === "1") {
            return Promise.resolve(pageDataResponse("prefetched"));
          }
          // The stale-while-revalidate refresh never answers; navigation must
          // not depend on it.
          return new Promise<RuntimeResponse>(() => {});
        },
      });
      harness.window.__veryfrontHydrationComplete?.();

      harness.router.prefetch("/prefetched");
      await flushUntil(() => harness.fetchCalls.length === 1);
      for (let i = 0; i < 20; i++) await flushMicrotasks();

      await harness.runtime.navigateSPA("/prefetched");

      assertEquals(
        harness.router.pathname,
        "/prefetched",
        "the cached payload alone must complete the navigation",
      );
      assertEquals(harness.reloads(), 0, "a cache-served navigation must not reload");
    });

    it("leaves history untouched when a redirect hands over to the document loader", async () => {
      const harness = createRouterHarness();
      harness.window.__veryfrontHydrationComplete?.();
      harness.setNextPageData({ redirect: { destination: "/moved" } });

      await harness.runtime.navigateSPA("/from");

      assertEquals(harness.window.location.href, "https://veryfront.test/moved");
      assertEquals(
        harness.historyCalls,
        [],
        "the document loader owns the history entry for a redirect",
      );
      assertEquals(
        harness.fetchCalls.length,
        1,
        "a redirect must resolve from a single page-data request",
      );
    });

    it("restores a page from history state on popstate without a network request", async () => {
      const harness = createRouterHarness({
        pathname: "/posts/42",
        hydrationParams: { id: "42" },
      });
      harness.window.__veryfrontHydrationComplete?.();

      harness.window.location.pathname = "/posts/7";
      const popstate = harness.listeners.popstate?.[0];
      if (!popstate) throw new Error("popstate handler was not registered");
      await popstate(
        {
          state: { pageData: { pagePath: "page", params: { id: "7" } } },
        } as unknown as RuntimeEvent,
      );

      assertEquals(harness.router.params, { id: "7" });
      assertEquals(
        harness.fetchCalls,
        [],
        "history state already carries the page data; popstate must not refetch",
      );
    });
  });
});
