import { JSDOM } from "npm:jsdom@28.0.0";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontRouter } from "./router.ts";
import { getNavigationStore } from "./navigation-store.ts";

const NAVIGATION_STORE_KEY = Symbol.for("veryfront.navigation.store.v1");

/** Drop the cross-bundle store so each test starts with fresh subscribers. */
function resetNavigationStore(): void {
  delete (globalThis as Record<symbol, unknown>)[NAVIGATION_STORE_KEY];
}

function installDom(url: string): () => void {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url });
  const window = dom.window;
  const keys = ["window", "document", "navigator", "self", "history", "location"] as const;
  const previous: Record<string, unknown> = {};
  for (const key of keys) previous[key] = (globalThis as Record<string, unknown>)[key];
  Object.assign(globalThis, {
    window,
    document: window.document,
    navigator: window.navigator,
    self: window,
    history: window.history,
    location: window.location,
  });
  resetNavigationStore();
  return () => {
    Object.assign(globalThis, previous);
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
});
