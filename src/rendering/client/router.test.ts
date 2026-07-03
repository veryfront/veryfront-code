import { JSDOM } from "npm:jsdom@28.0.0";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontRouter } from "./router.ts";

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
  return () => {
    Object.assign(globalThis, previous);
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
  it("a query-only change updates the URL and notifies, with no page load", async () => {
    const restore = installDom("https://example.com/dashboard");
    try {
      const router = new VeryfrontRouter({ baseUrl: "https://example.com" });
      const loads = spyOnLoaders(router);

      let notifications = 0;
      router.subscribe(() => notifications++);

      await router.navigate("/dashboard?tab=activity");

      assertEquals(loads, []);
      assertEquals(notifications, 1);
      assertEquals(globalThis.location.search, "?tab=activity");
      assertEquals(router.getCurrentHref(), "/dashboard?tab=activity");
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
      router.subscribe(() => notifications++);

      await router.navigate("/settings");

      assertEquals(loads, ["/settings"]);
      assertEquals(notifications, 1);
    } finally {
      restore();
    }
  });

  it("a popstate (pushState=false) query change soft-updates without a load", async () => {
    const restore = installDom("https://example.com/dashboard?tab=a");
    try {
      const router = new VeryfrontRouter({ baseUrl: "https://example.com" });
      const loads = spyOnLoaders(router);

      let notifications = 0;
      router.subscribe(() => notifications++);

      // Mirrors how the popstate handler calls navigate.
      await router.navigate("/dashboard?tab=b", false);

      assertEquals(loads, []);
      assertEquals(notifications, 1);
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
      const unsubscribe = router.subscribe(() => notifications++);
      await router.navigate("/dashboard?a=1");
      unsubscribe();
      await router.navigate("/dashboard?a=2");

      assertEquals(notifications, 1);
    } finally {
      restore();
    }
  });
});
