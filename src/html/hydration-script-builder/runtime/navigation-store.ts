/**
 * The compatibility bridge between this hydration runtime and release-pinned
 * router assets.
 *
 * Router releases since the v1 navigation store landed share the same
 * `Symbol.for` registry entry even when they predate the public
 * `getNavigationStore` export. Keeping the fallback store shape in sync with
 * the two v1 implementations lets those releases retain SPA navigation.
 *
 * This is a cross-bundle contract with the react runtime, which imports nothing
 * from here — the two sides meet only at the registry symbol and the store
 * shape below. Do not restructure either without changing both.
 */

const NAVIGATION_STORE_REGISTRY_KEY = "veryfront.navigation.store.v1";

export interface NavigationStore {
  subscribe(listener: () => void): () => void;
  getHref(): string;
  notify(): void;
  navigate(href: string, options?: { history?: string }): Promise<void> | void;
  setNavigator(next: (href: string, options?: { history?: string }) => Promise<void> | void): void;
}

export interface RouterRuntimeNamespace {
  getNavigationStore?: () => NavigationStore;
}

export interface ResolvedNavigationStore {
  /** True when the loaded router asset predates the public export. */
  usesRegistryFallback: boolean;
  getNavigationStore: () => NavigationStore;
}

export function resolveNavigationStore(
  RouterRuntime: RouterRuntimeNamespace,
): ResolvedNavigationStore {
  const usesRegistryFallback = typeof RouterRuntime.getNavigationStore !== "function";

  if (!usesRegistryFallback) {
    return {
      usesRegistryFallback,
      getNavigationStore: RouterRuntime.getNavigationStore as () => NavigationStore,
    };
  }

  return {
    usesRegistryFallback,
    getNavigationStore: () => {
      const storeKey = Symbol.for(NAVIGATION_STORE_REGISTRY_KEY);
      const registry = globalThis as
        & typeof globalThis
        & Record<symbol, NavigationStore | undefined>;
      const existing = registry[storeKey];
      if (existing) return existing;

      const listeners = new Set<() => void>();
      let navigator: ((href: string, options?: { history?: string }) => unknown) | null = null;
      const store: NavigationStore = {
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        getHref() {
          const loc = globalThis.location;
          return loc ? loc.pathname + loc.search + loc.hash : "/";
        },
        notify() {
          for (const listener of [...listeners]) {
            try {
              listener();
            } catch {
              // One subscriber must not prevent the others from updating.
            }
          }
        },
        navigate(href, options) {
          if (navigator) return navigator(href, options) as Promise<void>;
          globalThis.location?.assign(href);
          return Promise.resolve();
        },
        setNavigator(next) {
          navigator = next;
        },
      };

      registry[storeKey] = store;
      return store;
    },
  };
}
