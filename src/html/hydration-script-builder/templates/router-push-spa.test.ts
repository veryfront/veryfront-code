import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getRouterScript } from "./router.ts";

// Finding #7: useRouter().push()/replace() must perform SPA navigation, not a
// full document reload. `useRouter()` (from `veryfront/router` = react runtime
// core) routes push/replace/navigate through the shared navigation store's
// `navigate`, which delegates to whatever navigator has been registered via
// `setNavigator` — or falls back to `location.assign` (a full reload) when none
// is. The dev hydration runtime owns the real SPA navigator (`navigateSPA`, the
// same one that intercepts <Link> clicks), so it must register that navigator
// against the shared store. These tests evaluate the generated runtime with a
// stub store and assert the registration + SPA routing actually happen.

interface RuntimeLocation {
  origin: string;
  pathname: string;
  search: string;
  readonly href: string;
}
interface RuntimeRouter {
  pathname: string;
  push(path: string): void;
  replace(path: string): void;
}
interface FakeStore {
  navigator: ((href: string, options?: { history?: string }) => Promise<void>) | null;
  assignFallbackCount: number;
  navigate(href: string, options?: { history?: string }): Promise<void>;
  setNavigator(next: (href: string, options?: { history?: string }) => Promise<void>): void;
}

interface RuntimeHandle {
  router: RuntimeRouter;
  navigateSPA: (href: string, pushState?: boolean, restoreScroll?: boolean) => Promise<void>;
  store: FakeStore;
  win: { __veryfrontHydrationComplete?: () => void };
  setNextPageData: (data: unknown) => void;
}

function evaluateRouterRuntimeWithStore(): RuntimeHandle {
  const listeners: Record<string, Array<(e: unknown) => void>> = {};
  const addEventListener = (type: string, fn: (e: unknown) => void) => {
    (listeners[type] ??= []).push(fn);
  };

  const makeEl = () => ({
    style: {} as Record<string, unknown>,
    id: "",
    textContent: "",
    setAttribute() {},
    getAttribute() {
      return null;
    },
    prepend() {},
    remove() {},
    appendChild() {},
  });

  const rootEl = { __reactRoot: { render() {} } };
  const hydrationJson = JSON.stringify({ params: {} });
  const doc = {
    readyState: "complete",
    body: { prepend() {}, setAttribute() {}, removeAttribute() {}, appendChild() {} },
    head: { appendChild() {} },
    createElement: () => makeEl(),
    querySelector: () => null,
    querySelectorAll: () => [] as unknown[],
    getElementById: (id: string) => {
      if (id === "veryfront-hydration-data") return { textContent: hydrationJson };
      if (id === "root") return rootEl;
      return null;
    },
    addEventListener,
  };

  const win = {
    location: {
      origin: "https://veryfront.test",
      pathname: "/",
      search: "",
      get href() {
        return "https://veryfront.test" + this.pathname + this.search;
      },
    } as RuntimeLocation,
    history: { pushState() {}, replaceState() {}, back() {}, forward() {} },
    addEventListener,
    dispatchEvent() {
      return true;
    },
    scrollTo() {},
    scrollY: 0,
    __veryfrontRouter: undefined as RuntimeRouter | undefined,
    __veryfrontHydrationComplete: undefined as (() => void) | undefined,
  };

  let nextPageData: unknown = { pagePath: "page", params: {} };
  const fetchStub = () =>
    Promise.resolve({
      ok: true,
      status: 200,
      url: "/_veryfront/page-data/page.json",
      headers: { get: () => null },
      json: () => Promise.resolve(nextPageData),
    });

  const RouterProvider = () => ({});
  const PageContextProvider = () => ({});
  const React = { createElement: () => ({}) };
  const loadComponent = () => Promise.resolve(() => null);

  // Faithful stand-in for the cross-bundle navigation store the react runtime's
  // RouterProvider reads. `navigate` delegates to the registered navigator, or
  // records a full-reload fallback when none is registered — exactly the real
  // store's `navigate(href) { if (navigator) return navigator(...); location.assign(...) }`.
  const store: FakeStore = {
    navigator: null,
    assignFallbackCount: 0,
    navigate(href, options) {
      if (store.navigator) return store.navigator(href, options);
      store.assignFallbackCount++;
      return Promise.resolve();
    },
    setNavigator(next) {
      store.navigator = next;
    },
  };
  const getNavigationStore = () => store;

  const factory = new Function(
    "window",
    "document",
    "fetch",
    "React",
    "RouterProvider",
    "PageContextProvider",
    "loadComponent",
    "setTimeout",
    "clearTimeout",
    "getNavigationStore",
    getRouterScript() + "\nreturn { router, navigateSPA };",
  );

  const handle = factory(
    win,
    doc,
    fetchStub,
    React,
    RouterProvider,
    PageContextProvider,
    loadComponent,
    () => 0,
    () => {},
    getNavigationStore,
  ) as { router: RuntimeRouter; navigateSPA: RuntimeHandle["navigateSPA"] };

  return {
    router: handle.router,
    navigateSPA: handle.navigateSPA,
    store,
    win,
    setNextPageData: (data: unknown) => {
      nextPageData = data;
    },
  };
}

describe("hydration-script-builder/templates/router — push SPA navigator (finding #7)", () => {
  it("registers the SPA navigator against the shared navigation store", () => {
    const runtime = evaluateRouterRuntimeWithStore();
    // Without a registered navigator, useRouter().push() falls back to a full
    // document reload (location.assign). The runtime must register navigateSPA.
    assertEquals(typeof runtime.store.navigator, "function");
  });

  it("routes store.navigate({history:'push'}) through SPA navigation, not a full reload", async () => {
    const runtime = evaluateRouterRuntimeWithStore();
    runtime.win.__veryfrontHydrationComplete?.();
    runtime.setNextPageData({ pagePath: "page", params: {} });
    runtime.win.location.pathname = "/next";

    // This is exactly what useRouter().push('/next') does in the react runtime.
    await runtime.store.navigate("/next", { history: "push" });

    // SPA navigation ran (router snapshot moved) and the store never fell back
    // to the full-reload path.
    assertEquals(runtime.store.assignFallbackCount, 0);
    assertEquals(runtime.router.pathname, "/next");
  });

  it("routes store.navigate({history:'replace'}) through SPA navigation, not a full reload", async () => {
    const runtime = evaluateRouterRuntimeWithStore();
    runtime.win.__veryfrontHydrationComplete?.();
    runtime.setNextPageData({ pagePath: "page", params: {} });
    runtime.win.location.pathname = "/replaced";

    await runtime.store.navigate("/replaced", { history: "replace" });

    assertEquals(runtime.store.assignFallbackCount, 0);
    assertEquals(runtime.router.pathname, "/replaced");
  });
});
