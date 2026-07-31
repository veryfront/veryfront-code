import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { type NavigationStore, resolveNavigationStore } from "./navigation-store.ts";

const REGISTRY_KEY = Symbol.for("veryfront.navigation.store.v1");

type StoreRegistry = Record<symbol, NavigationStore | undefined>;

/**
 * The fallback store memoises itself in a `Symbol.for` registry on globalThis,
 * so every test that touches it must clear the entry again.
 */
async function withCleanRegistry(run: () => void | Promise<void>): Promise<void> {
  try {
    await run();
  } finally {
    delete (globalThis as unknown as StoreRegistry)[REGISTRY_KEY];
  }
}

describe("hydration-script-builder/runtime/navigation-store", () => {
  it("uses the router asset's own export when it has one", () => {
    const store = { subscribe: () => () => {} } as unknown as NavigationStore;
    const getNavigationStore = () => store;

    const resolved = resolveNavigationStore({ getNavigationStore });

    assertEquals(resolved.usesRegistryFallback, false);
    assertEquals(resolved.getNavigationStore === getNavigationStore, true);
    assertEquals(resolved.getNavigationStore(), store);
  });

  it("falls back to the registry store for router assets without the export", async () => {
    await withCleanRegistry(() => {
      const resolved = resolveNavigationStore({});

      assertEquals(resolved.usesRegistryFallback, true);
      assertEquals(resolved.getNavigationStore() === resolved.getNavigationStore(), true);
    });
  });

  it("reuses a store another bundle already registered", async () => {
    await withCleanRegistry(() => {
      const seeded = { subscribe: () => () => {} } as unknown as NavigationStore;
      (globalThis as unknown as StoreRegistry)[REGISTRY_KEY] = seeded;

      assertEquals(resolveNavigationStore({}).getNavigationStore(), seeded);
    });
  });

  it("unsubscribes a listener through the returned disposer", async () => {
    await withCleanRegistry(() => {
      const store = resolveNavigationStore({}).getNavigationStore();
      let notified = 0;

      const unsubscribe = store.subscribe(() => {
        notified++;
      });
      store.notify();
      unsubscribe();
      store.notify();

      assertEquals(notified, 1);
    });
  });

  it("notifies every listener even when one throws", async () => {
    await withCleanRegistry(() => {
      const store = resolveNavigationStore({}).getNavigationStore();
      const notified: string[] = [];

      store.subscribe(() => {
        notified.push("first");
      });
      store.subscribe(() => {
        throw new Error("subscriber blew up");
      });
      store.subscribe(() => {
        notified.push("third");
      });
      store.notify();

      assertEquals(notified, ["first", "third"]);
    });
  });

  it("delegates navigation to the registered navigator", async () => {
    await withCleanRegistry(async () => {
      const navigated: Array<{ href: string; options?: { history?: string } }> = [];
      const store = resolveNavigationStore({}).getNavigationStore();

      store.setNavigator((href, options) => {
        navigated.push({ href, options });
        return Promise.resolve();
      });
      await store.navigate("/docs", { history: "push" });

      assertEquals(navigated, [{ href: "/docs", options: { history: "push" } }]);
    });
  });

  it("uses stacked navigator registrations and restores the previous owner", async () => {
    await withCleanRegistry(async () => {
      const store = resolveNavigationStore({}).getNavigationStore();
      const calls: string[] = [];

      const releaseFirst = store.setNavigator(async (href) => {
        calls.push(`first:${href}`);
      });
      const releaseSecond = store.setNavigator(async (href) => {
        calls.push(`second:${href}`);
      });

      if (typeof releaseFirst !== "function" || typeof releaseSecond !== "function") {
        throw new Error("fallback navigator registrations must return disposers");
      }

      await store.navigate("/one");
      releaseSecond();
      releaseSecond();
      await store.navigate("/two");
      releaseFirst();

      assertEquals(calls, ["second:/one", "first:/two"]);
    });
  });
});
