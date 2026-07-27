import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getNavigationStoreCompatibilityScript } from "./navigation-store.ts";

interface NavigationOptions {
  history?: "push" | "replace" | "none";
}

interface NavigationStore {
  subscribe(listener: () => void): () => void;
  getHref(): string;
  notify(): void;
  navigate(href: string, options?: NavigationOptions): Promise<void>;
  setNavigator(
    navigator: (href: string, options?: NavigationOptions) => Promise<void>,
  ): () => void;
}

interface TestGlobal {
  location: {
    pathname: string;
    search: string;
    hash: string;
    assign(href: string): void;
    replace(href: string): void;
  };
  [key: symbol]: unknown;
}

function evaluateCompatibilityBridge(
  routerRuntime: Record<string, unknown>,
  testGlobal: TestGlobal,
): {
  getNavigationStore: () => NavigationStore;
  navigationStoreUsesRegistryFallback: boolean;
} {
  return new Function(
    "RouterRuntime",
    "globalThis",
    `${getNavigationStoreCompatibilityScript()}
return { getNavigationStore, navigationStoreUsesRegistryFallback };`,
  )(routerRuntime, testGlobal) as {
    getNavigationStore: () => NavigationStore;
    navigationStoreUsesRegistryFallback: boolean;
  };
}

function createTestGlobal(): {
  global: TestGlobal;
  assignments: string[];
  replacements: string[];
} {
  const assignments: string[] = [];
  const replacements: string[] = [];
  return {
    global: {
      location: {
        pathname: "/current",
        search: "?tab=one",
        hash: "#section",
        assign: (href) => assignments.push(href),
        replace: (href) => replacements.push(href),
      },
    },
    assignments,
    replacements,
  };
}

describe("hydration navigation-store compatibility bridge", () => {
  it("creates the current v1 registry store when the router has no named export", async () => {
    const test = createTestGlobal();
    const bridge = evaluateCompatibilityBridge({}, test.global);
    const store = bridge.getNavigationStore();

    assertEquals(bridge.navigationStoreUsesRegistryFallback, true);
    assertEquals(store.getHref(), "/current?tab=one#section");

    await store.navigate("/unchanged", { history: "none" });
    await store.navigate("/replacement", { history: "replace" });
    await store.navigate("/assignment", { history: "push" });

    assertEquals(test.assignments, ["/assignment"]);
    assertEquals(test.replacements, ["/replacement"]);
  });

  it("uses stacked navigator registrations and restores the previous owner", async () => {
    const test = createTestGlobal();
    const store = evaluateCompatibilityBridge({}, test.global).getNavigationStore();
    const calls: string[] = [];

    const releaseFirst = store.setNavigator(async (href) => {
      calls.push(`first:${href}`);
    });
    const releaseSecond = store.setNavigator(async (href) => {
      calls.push(`second:${href}`);
    });

    await store.navigate("/one");
    releaseSecond();
    releaseSecond();
    await store.navigate("/two");
    releaseFirst();
    await store.navigate("/fallback");

    assertEquals(calls, ["second:/one", "first:/two"]);
    assertEquals(test.assignments, ["/fallback"]);
  });

  it("isolates subscriber failures and supports idempotent unsubscription", () => {
    const test = createTestGlobal();
    const store = evaluateCompatibilityBridge({}, test.global).getNavigationStore();
    let successfulNotifications = 0;

    store.subscribe(() => {
      throw new Error("subscriber failed");
    });
    const unsubscribe = store.subscribe(() => {
      successfulNotifications++;
    });

    store.notify();
    unsubscribe();
    unsubscribe();
    store.notify();

    assertEquals(successfulNotifications, 1);
  });

  it("reuses an existing legacy registry store without replacing its identity", () => {
    const test = createTestGlobal();
    const existing = {
      subscribe: () => () => {},
      getHref: () => "/legacy",
      notify() {},
      navigate: () => Promise.resolve(),
      setNavigator: () => () => {},
    };
    test.global[Symbol.for("veryfront.navigation.store.v1")] = existing;

    const store = evaluateCompatibilityBridge({}, test.global).getNavigationStore();

    assertEquals(store, existing);
  });

  it("delegates to an exported router store when the release provides one", () => {
    const test = createTestGlobal();
    const exportedStore = {
      subscribe: () => () => {},
      getHref: () => "/exported",
      notify() {},
      navigate: () => Promise.resolve(),
      setNavigator: () => () => {},
    };
    const bridge = evaluateCompatibilityBridge(
      { getNavigationStore: () => exportedStore },
      test.global,
    );

    assertEquals(bridge.navigationStoreUsesRegistryFallback, false);
    assertEquals(bridge.getNavigationStore(), exportedStore);
  });
});
