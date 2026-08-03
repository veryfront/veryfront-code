import React, { useEffect } from "react";
import {
  descriptorFromHeadProps,
  HEAD_REACT_OWNER_ATTRIBUTE,
  HEAD_SERVER_COMMIT_ATTRIBUTE,
  HEAD_SSR_PAYLOAD_ATTRIBUTE,
  type ManagedHeadDescriptor,
  serializeManagedHeadPayload,
} from "#veryfront/html/managed-head-protocol.ts";
import { getClientHeadManager, getManagedHeadNonce } from "#veryfront/html/client-head-manager.ts";
import { useServerRenderContext } from "#veryfront/react/server-render-context.ts";

/** Router state exposed through `useRouter()`. */
export interface RouterValue {
  /** Active domain for the current route. */
  domain: string;
  /** Full current path including the pathname. */
  path: string;
  /** Current URL pathname. */
  pathname: string;
  /** Route parameters matched from the current route. */
  params: Record<string, string>;
  /** Query parameters for the current URL. */
  query: Record<string, string>;
  /** Whether the route is rendered in preview mode. */
  isPreview: boolean;
  /** Whether the client router is mounted. */
  isMounted: boolean;
  /** Navigate to a URL using the active router. */
  navigate: (url: string) => Promise<void>;
  /** Push a new URL onto the history stack. */
  push: (url: string) => Promise<void>;
  /** Replace the current history entry with a URL. */
  replace: (url: string) => Promise<void>;
  /** Reload the current route. */
  reload: () => Promise<void>;
}

/** Props accepted by `<Link>`. */
export type LinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  /** Enable Veryfront prefetch handling for this link. */
  prefetch?: boolean;
};

/** Props accepted by `<RouterProvider>`. */
export interface RouterProviderProps {
  /** React children rendered within the router context. */
  children: React.ReactNode;
  /**
   * The router snapshot. On the server it is exposed verbatim. On the client it
   * seeds `params`/`domain`/`isPreview` and the initial `pathname`/`query` — the
   * server-render snapshot the first client render must match — after which
   * `pathname`/`query` track the live URL through the navigation store.
   *
   * This is the single source for everything the URL and route match know;
   * callers hand over one `RouterValue` rather than loose href/param fields.
   */
  router?: RouterValue;
}

/** Heading metadata extracted from MDX content. */
export interface MdxHeading {
  /** Visible heading text. */
  text: string;
  /** Stable heading anchor ID. */
  id: string;
  /** Heading level from 1 to 6. */
  level: number;
}

/** Page context exposed to route and MDX components. */
export interface PageContextValue {
  /** Route slug for the current page. */
  slug: string;
  /** Current route path. */
  path: string;
  /** Dynamic route parameters. */
  params: Record<string, string>;
  /** Query parameters for the current URL. */
  query: Record<string, string>;
  /** Parsed page frontmatter. */
  frontmatter: Record<string, unknown>;
  /**
   * Props returned by the page's `getServerData` (the object under its
   * `props` key). Exposed here so layouts and nested components can read
   * server data without prop-drilling from the page. Empty object when the
   * page has no `getServerData`. Populated identically on the server render,
   * the hydration seed, and client navigation.
   */
  data: Record<string, unknown>;
  /** Headings discovered in the page content. */
  headings: MdxHeading[];
  /** MDX headings discovered in the page content. */
  mdxHeadings: MdxHeading[];
}

/**
 * Input accepted by {@link PageContextProvider}. `data` (the page's
 * `getServerData` props) is optional here so seeds built before the field
 * existed keep compiling; the provider merges the seed over
 * {@link defaultPageContext}, so an omitted field surfaces as its documented
 * empty default rather than `undefined`.
 */
export type PageContextSeed =
  & Omit<PageContextValue, "data">
  & { data?: Record<string, unknown> };

/** Props accepted by `<PageContextProvider>`. */
export interface PageContextProviderProps {
  /** React children rendered within the page context. */
  children: React.ReactNode;
  /** Page context seed to expose to descendants. */
  pageContext?: PageContextSeed;
}

const defaultRouter: RouterValue = {
  domain: "",
  path: "/",
  pathname: "/",
  params: {},
  query: {},
  isPreview: false,
  isMounted: false,
  navigate: async () => {},
  push: async () => {},
  replace: async () => {},
  reload: async () => {},
};

const defaultPageContext: PageContextValue = {
  slug: "/",
  path: "/",
  params: {},
  query: {},
  frontmatter: {},
  data: {},
  headings: [],
  mdxHeadings: [],
};

const ROUTER_CONTEXT_SYMBOL = Symbol.for("veryfront.react.router-context");
const PAGE_CONTEXT_SYMBOL = Symbol.for("veryfront.react.page-context");

const globalRouterContext = globalThis as typeof globalThis & {
  [ROUTER_CONTEXT_SYMBOL]?: React.Context<RouterValue>;
};

const globalPageContext = globalThis as typeof globalThis & {
  [PAGE_CONTEXT_SYMBOL]?: React.Context<PageContextValue>;
};

const RouterContext = globalRouterContext[ROUTER_CONTEXT_SYMBOL] ??
  (globalRouterContext[ROUTER_CONTEXT_SYMBOL] = React.createContext<RouterValue>(defaultRouter));

const PageContextContext = globalPageContext[PAGE_CONTEXT_SYMBOL] ??
  (globalPageContext[PAGE_CONTEXT_SYMBOL] = React.createContext(defaultPageContext));

type ClientHeadDescriptor = ManagedHeadDescriptor;

function createClientHeadDescriptor(
  child: React.ReactElement,
  nonce: string | undefined,
): ClientHeadDescriptor | null {
  if (typeof child.type !== "string") return null;
  return descriptorFromHeadProps(
    child.type,
    child.props as Record<string, unknown>,
    nonce,
  );
}

/** How a navigation should affect the history stack. */
type HistoryMode = "push" | "replace" | "none";

/** Options accepted by the navigation store's `navigate`. */
interface NavigateOptions {
  history?: HistoryMode;
}

/**
 * The cross-bundle navigation store the client router and this React runtime
 * share. This is an inline mirror of `rendering/client/navigation-store.ts`,
 * kept here so the public React runtime bundle does not import the rendering
 * layer. The shared `Symbol.for` key guarantees both bundles resolve the *same*
 * runtime object regardless of which one evaluates first — so `RouterProvider`
 * can subscribe synchronously on its first render, with no boot-order race.
 */
interface NavigationStore {
  subscribe(listener: () => void): () => void;
  getHref(): string;
  notify(): void;
  navigate(href: string, options?: NavigateOptions): Promise<void>;
  setNavigator(navigator: (href: string, options?: NavigateOptions) => Promise<void>): void;
}

const NAVIGATION_STORE_KEY = Symbol.for("veryfront.navigation.store.v1");

export function getNavigationStore(): NavigationStore {
  const holder = globalThis as Record<symbol, unknown>;
  const existing = holder[NAVIGATION_STORE_KEY] as NavigationStore | undefined;
  if (existing) return existing;

  const listeners = new Set<() => void>();
  let navigator: ((href: string, options?: NavigateOptions) => Promise<void>) | null = null;

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
      for (const listener of [...listeners]) {
        try {
          listener();
        } catch {
          // A subscriber threw; ignore it and continue notifying the others.
        }
      }
    },
    navigate(href, options) {
      if (navigator) return navigator(href, options);
      globalThis.location?.assign(href);
      return Promise.resolve();
    },
    setNavigator(next) {
      navigator = next;
    },
  };

  holder[NAVIGATION_STORE_KEY] = store;
  return store;
}

function hrefFromRouter(router: RouterValue | undefined): string | undefined {
  if (!router) return undefined;
  const search = new URLSearchParams(router.query ?? {}).toString();
  return search ? `${router.pathname}?${search}` : router.pathname;
}

function splitHref(href: string): { pathname: string; search: string } {
  const queryIndex = href.indexOf("?");
  if (queryIndex === -1) {
    const hashIndex = href.indexOf("#");
    return { pathname: hashIndex === -1 ? href : href.slice(0, hashIndex), search: "" };
  }
  const afterQuery = href.slice(queryIndex + 1);
  const hashIndex = afterQuery.indexOf("#");
  return {
    pathname: href.slice(0, queryIndex),
    search: hashIndex === -1 ? afterQuery : afterQuery.slice(0, hashIndex),
  };
}

/**
 * Provides the router context. `pathname`/`query` track the live URL through the
 * shared navigation store's `useSyncExternalStore` surface; `params`/`domain`
 * are seeded from the `router` prop. One component serves both sides: React uses
 * `getServerSnapshot` (the seed href) during SSR and the live store on the
 * client, so there is no environment branch — the server render and the first
 * client render match by construction.
 *
 * The store is a stable singleton that exists on first access, so there is no
 * "is the router mounted yet?" race: the subscription is live from the first
 * render, and the router's navigations notify through the same object. Page
 * context (frontmatter/slug/headings) is a separate concern, provided by
 * `PageContextProvider`, which derives its live location from this router.
 */
export function RouterProvider({ router, children }: RouterProviderProps): React.ReactElement {
  const store = getNavigationStore();
  const seed = router ?? defaultRouter;
  // The server snapshot is derived from the router itself, so the first client
  // render matches the server exactly (both come from one `RouterValue`).
  const seedHref = hrefFromRouter(router) ?? "/";
  const getServerSnapshot = React.useCallback(() => seedHref, [seedHref]);

  const href = React.useSyncExternalStore(store.subscribe, store.getHref, getServerSnapshot);
  const { pathname, search } = splitHref(href);

  const query = React.useMemo(
    () => Object.fromEntries(new URLSearchParams(search)) as Record<string, string>,
    [search],
  );

  // `isMounted` is `false` on the server and the first client render (so they
  // agree — hydration-safe), then flips `true` after mount. Consumers guard on
  // this (e.g. `if (!router.isMounted) return null`).
  const [isMounted, setIsMounted] = React.useState(false);
  React.useEffect(() => setIsMounted(true), []);

  const routerValue = React.useMemo<RouterValue>(
    () => ({
      domain: seed.domain || (globalThis.location?.hostname ?? ""),
      path: pathname,
      pathname,
      params: seed.params,
      query,
      isPreview: seed.isPreview,
      isMounted,
      navigate: (url: string) => store.navigate(url, { history: "push" }),
      push: (url: string) => store.navigate(url, { history: "push" }),
      replace: (url: string) => store.navigate(url, { history: "replace" }),
      reload: async () => {
        globalThis.location?.reload();
      },
    }),
    [pathname, query, seed.params, seed.domain, seed.isPreview, isMounted, store],
  );

  return React.createElement(RouterContext.Provider, { value: routerValue }, children);
}

/** Options for {@link wrapForHydration}. */
export interface HydrationWrapOptions {
  /** Route params from the initial match. */
  params?: Record<string, string>;
  /** Page frontmatter, exposed reactively through `usePageContext()`. */
  frontmatter?: Record<string, unknown>;
  /**
   * Props returned by the page's `getServerData`, exposed as
   * `usePageContext().data`. Seeded here so a hydrated client tree under an
   * App/RSC page reads the same server data the server render saw, instead of
   * an empty object.
   */
  data?: Record<string, unknown>;
}

/**
 * Wraps a hydrated client component in `RouterProvider` (router state) nested
 * with `PageContextProvider` (frontmatter), seeded from the live location plus
 * the initial route match — mirroring how SSR wraps the tree.
 *
 * The RSC hydration path calls this through a runtime import of
 * `veryfront/router`, so it runs under the app's React instance — the same one
 * the hydrated component uses, and the same providers and `React` this module
 * already reference. That is why the caller does not (and must not) pass a
 * `React` across the module boundary: the wrapping happens here, inside the
 * module that owns React.
 */
export function wrapForHydration(
  child: React.ReactNode,
  options: HydrationWrapOptions = {},
): React.ReactElement {
  const loc = globalThis.location;
  const pathname = loc?.pathname ?? "/";
  const params = options.params ?? {};
  const query = loc
    ? (Object.fromEntries(new URLSearchParams(loc.search)) as Record<string, string>)
    : {};
  const router: RouterValue = {
    ...defaultRouter,
    domain: loc?.hostname ?? "",
    path: pathname,
    pathname,
    params,
    query,
  };
  // `PageContextProvider` derives its live location from the router above; only
  // the page-authored bits (frontmatter/slug) are seeded here.
  const pageContext: PageContextValue = {
    ...defaultPageContext,
    slug: pathname,
    path: pathname,
    params,
    query,
    frontmatter: options.frontmatter ?? {},
    data: options.data ?? {},
  };
  return React.createElement(RouterProvider, {
    router,
    children: React.createElement(PageContextProvider, { pageContext, children: child }),
  });
}

/**
 * Reads the router context: `pathname`, `query`, `params`, and the navigation
 * actions. Reactive across client-side navigation — this is the single hook for
 * location and navigation state.
 */
export function useRouter(): RouterValue {
  return React.useContext(RouterContext);
}

/** Renders an anchor element annotated for Veryfront prefetch handling. */
export function Link({
  prefetch = true,
  children,
  ...rest
}: LinkProps): React.ReactElement {
  return React.createElement(
    "a",
    { ...rest, "data-prefetch": prefetch ? "true" : "false" },
    children,
  );
}

/**
 * Provides page context to route and MDX descendants. Page-authored fields
 * (`frontmatter`, `slug`, `headings`) come from the `pageContext` prop; the
 * location fields (`path`, `query`, `params`) are derived from the router so
 * they stay reactive and there is a single source of truth — `usePageContext()`
 * exposes the same `query`/`pathname` as `useRouter()`. When rendered outside a
 * `RouterProvider` (no live router) it falls back to the seed's own location.
 */
export function PageContextProvider({
  children,
  pageContext,
}: PageContextProviderProps): React.ReactElement {
  const router = React.useContext(RouterContext);
  const hasRouter = router !== defaultRouter;

  const value = React.useMemo<PageContextValue>(
    () => {
      // Merge the seed over defaults so a seed that omits a newer field (e.g.
      // `data`) still exposes it as its documented empty default, and unchecked
      // JS callers never read `undefined` off the context.
      const seed: PageContextValue = { ...defaultPageContext, ...pageContext };
      return hasRouter
        ? { ...seed, path: router.pathname, query: router.query, params: router.params }
        : seed;
    },
    [pageContext, hasRouter, router.pathname, router.query, router.params],
  );

  return React.createElement(PageContextContext.Provider, { value }, children);
}

/** Reads the current page context. */
export function usePageContext(): PageContextValue {
  return React.useContext(PageContextContext);
}

/**
 * Flattens `Head` children into host elements, unwrapping React fragments so
 * `<Head><>…</></Head>` behaves like direct children — matching React's
 * transparent-fragment semantics. `React.Children` already flattens arrays
 * (so `.map()` works), but passes a fragment through as a single element whose
 * `type` is `Symbol(react.fragment)`, which matched none of the tag branches
 * and was silently dropped.
 */
function flattenHeadChildren(children: React.ReactNode): React.ReactElement[] {
  const out: React.ReactElement[] = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    if (child.type === React.Fragment) {
      const nested = (child.props as { children?: React.ReactNode }).children;
      out.push(...flattenHeadChildren(nested));
      return;
    }
    out.push(child);
  });
  return out;
}

/** Applies document head elements during SSR and client rendering. */
export function Head({ children }: { children: React.ReactNode }): React.ReactElement {
  const serverRenderContext = useServerRenderContext();
  const ownerRef = React.useRef<object | null>(null);
  const anchorRef = React.useRef<HTMLDivElement | null>(null);
  const managerRef = React.useRef<ReturnType<typeof getClientHeadManager> | null>(
    null,
  );
  if (!ownerRef.current) ownerRef.current = {};
  const payload = serializeManagedHeadPayload(
    flattenHeadChildren(children)
      .map((child) => createClientHeadDescriptor(child, undefined))
      .filter((descriptor): descriptor is ClientHeadDescriptor => descriptor !== null),
  );
  const serverCommitToken = serverRenderContext?.registerHeadPayload(payload);

  useEffect(() => {
    const owner = ownerRef.current;
    const anchor = anchorRef.current;
    const ownerDocument = anchor?.ownerDocument;
    if (!owner || !anchor || !ownerDocument) return;

    const nonce = getManagedHeadNonce(ownerDocument);
    const descriptors = flattenHeadChildren(children)
      .map((child) => createClientHeadDescriptor(child, nonce))
      .filter((descriptor): descriptor is ClientHeadDescriptor => descriptor !== null);
    const manager = getClientHeadManager(ownerDocument);
    if (managerRef.current && managerRef.current !== manager) {
      managerRef.current.deactivate(owner);
    }
    manager.update(owner, anchor, descriptors);
    managerRef.current = manager;
  });

  useEffect(() => {
    const owner = ownerRef.current;
    if (!owner) return;
    return () => {
      managerRef.current?.deactivate(owner);
      managerRef.current = null;
    };
  }, []);

  return React.createElement("div", {
    ref: anchorRef,
    "data-veryfront-head": "1",
    [HEAD_REACT_OWNER_ATTRIBUTE]: "1",
    [HEAD_SERVER_COMMIT_ATTRIBUTE]: serverCommitToken,
    [HEAD_SSR_PAYLOAD_ATTRIBUTE]: payload,
    suppressHydrationWarning: true,
    style: { display: "none" },
  });
}

export { RouterProvider as Router };
