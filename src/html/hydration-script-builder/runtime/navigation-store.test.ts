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

/**
 * `globalThis.location` is an own writable, configurable property under Deno
 * whose value is undefined, so a test can define a stub and restore the
 * original descriptor afterwards.
 */
async function withLocation(
  value: unknown,
  run: () => void | Promise<void>,
): Promise<void> {
  const original = Object.getOwnPropertyDescriptor(globalThis, "location");
  Object.defineProperty(globalThis, "location", { value, writable: true, configurable: true });
  try {
    await run();
  } finally {
    if (original) {
      Object.defineProperty(globalThis, "location", original);
    } else {
      delete (globalThis as unknown as Record<string, unknown>).location;
    }
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
      assertEquals(
        (globalThis as unknown as StoreRegistry)[REGISTRY_KEY] === resolved.getNavigationStore(),
        true,
        "the fallback store must be published under the shared registry symbol so a pinned router asset binds to the same object",
      );
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

  it("reports the full location href including search and hash", async () => {
    await withCleanRegistry(async () => {
      await withLocation({ pathname: "/docs", search: "?q=1", hash: "#top" }, () => {
        assertEquals(
          resolveNavigationStore({}).getNavigationStore().getHref(),
          "/docs?q=1#top",
          "getHref must include search and hash so search-only navigations change the snapshot",
        );
      });
    });
  });

  it('falls back to "/" when there is no location', async () => {
    await withCleanRegistry(async () => {
      await withLocation(undefined, () => {
        assertEquals(
          resolveNavigationStore({}).getNavigationStore().getHref(),
          "/",
          "getHref must fall back to the documented root path off-document",
        );
      });
    });
  });

  it("falls back to a document navigation before a navigator is registered", async () => {
    await withCleanRegistry(async () => {
      const assigned: string[] = [];

      await withLocation({ assign: (href: string) => assigned.push(href) }, async () => {
        const store = resolveNavigationStore({}).getNavigationStore();
        await store.navigate("/docs");
      });

      assertEquals(
        assigned,
        ["/docs"],
        "navigate must fall back to a real page load until a navigator registers",
      );
    });
  });
});
