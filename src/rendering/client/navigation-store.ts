/**
 * Cross-bundle navigation store.
 *
 * The client router (`rendering/client/router.ts`) and the React runtime
 * (`veryfront/router`, `react/runtime/core.ts`) are compiled into separate
 * bundles, so they cannot share module state directly. They coordinate through
 * this store, held on `globalThis` under a registered `Symbol.for` key so both
 * bundles resolve the *same* object at runtime — the same technique the React
 * runtime already uses for its context singletons.
 *
 * The store always exists: whichever bundle touches it first creates it. That is
 * what lets `RouterProvider` subscribe synchronously on its first render with no
 * polling and no "is the router ready yet?" race. The router attaches its real
 * navigation implementation via {@link NavigationStore.setNavigator} when it
 * boots; until then {@link NavigationStore.navigate} falls back to a full-page
 * load so links still work.
 *
 * `react/runtime/core.ts` keeps an inline mirror of {@link getNavigationStore}
 * to avoid importing the rendering layer into the public React runtime bundle.
 * The two must stay in sync; the shared `Symbol.for` key guarantees they resolve
 * the same object regardless of which one runs first.
 */

/** How a navigation should affect the history stack. */
export type HistoryMode = "push" | "replace" | "none";

/** Options accepted by {@link NavigationStore.navigate}. */
export interface NavigateOptions {
  /** History behaviour for this navigation. Defaults to `"push"`. */
  history?: HistoryMode;
}

/** The stable navigation surface shared between the router and React bundles. */
export interface NavigationStore {
  /**
   * Subscribe to completed navigations. Returns an unsubscribe function. The
   * reference is stable across the store's lifetime, as `useSyncExternalStore`
   * requires.
   */
  subscribe(listener: () => void): () => void;
  /** The current href (`pathname` + `search` + `hash`) — the single source of truth. */
  getHref(): string;
  /** Notify all subscribers that a navigation completed. Called by the router. */
  notify(): void;
  /** Navigate through the attached router, or a full page load if none is attached. */
  navigate(href: string, options?: NavigateOptions): Promise<void>;
  /**
   * Attach the real navigation implementation. Called by the router on boot.
   * Current stores return an idempotent disposer that only releases this
   * registration. The `void` branch preserves compatibility with stores made
   * by older v1 bundles, whose method did not return a disposer.
   */
  setNavigator(
    navigator: (href: string, options?: NavigateOptions) => Promise<void>,
  ): void | (() => void);
}

const STORE_KEY = Symbol.for("veryfront.navigation.store.v1");

/** Returns the shared navigation store, creating it on first access. */
export function getNavigationStore(): NavigationStore {
  const holder = globalThis as Record<symbol, unknown>;
  const existing = holder[STORE_KEY] as NavigationStore | undefined;
  if (existing) return existing;

  const listeners = new Set<() => void>();
  const navigatorRegistrations: Array<{
    navigate: (href: string, options?: NavigateOptions) => Promise<void>;
  }> = [];

  const store: NavigationStore = {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getHref() {
      const loc = globalThis.location;
      return loc ? `${loc.pathname}${loc.search}${loc.hash}` : "/";
    },
    notify() {
      // Snapshot the set so a listener that unsubscribes mid-notify is safe, and
      // isolate throwers so one bad subscriber does not stop the rest.
      for (const listener of [...listeners]) {
        try {
          listener();
        } catch {
          // A subscriber threw; ignore it and continue notifying the others.
        }
      }
    },
    navigate(href, options) {
      const registration = navigatorRegistrations.at(-1);
      if (registration) return registration.navigate(href, options);
      // No router attached yet: honour the requested history contract. For
      // `none`, the browser has already moved (for example during popstate), so
      // mutating location again would create an incorrect second navigation.
      const location = globalThis.location;
      if (location && options?.history !== "none") {
        if (options?.history === "replace") location.replace(href);
        else location.assign(href);
      }
      return Promise.resolve();
    },
    setNavigator(next) {
      const registration = { navigate: next };
      navigatorRegistrations.push(registration);
      let active = true;

      return () => {
        if (!active) return;
        active = false;
        const index = navigatorRegistrations.indexOf(registration);
        if (index !== -1) navigatorRegistrations.splice(index, 1);
      };
    },
  };

  holder[STORE_KEY] = store;
  return store;
}
