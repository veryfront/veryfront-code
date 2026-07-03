import React, { useEffect } from "react";

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
  /**
   * Page frontmatter, exposed reactively through `usePageContext()`. This is the
   * one page-level datum a `RouterValue` does not already carry.
   */
  frontmatter?: Record<string, unknown>;
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
  /** Headings discovered in the page content. */
  headings: MdxHeading[];
  /** MDX headings discovered in the page content. */
  mdxHeadings: MdxHeading[];
}

/** Props accepted by `<PageContextProvider>`. */
export interface PageContextProviderProps {
  /** React children rendered within the page context. */
  children: React.ReactNode;
  /** Page context value to expose to descendants. */
  pageContext?: PageContextValue;
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
  headings: [],
  mdxHeadings: [],
};

const ROUTER_CONTEXT_SYMBOL = Symbol.for("veryfront.react.router-context");
const PAGE_CONTEXT_SYMBOL = Symbol.for("veryfront.react.page-context");
const HEAD_COLLECTOR_SYMBOL = Symbol.for("veryfront.react.collect-head");

const globalRouterContext = globalThis as typeof globalThis & {
  [ROUTER_CONTEXT_SYMBOL]?: React.Context<RouterValue>;
};

const globalPageContext = globalThis as typeof globalThis & {
  [PAGE_CONTEXT_SYMBOL]?: React.Context<PageContextValue>;
};

type CollectHeadFn = (data: {
  title?: string;
  description?: string;
  metas?: Array<{ name?: string; property?: string; content: string }>;
  links?: Array<Record<string, string>>;
  styles?: string[];
  scripts?: Array<Record<string, string | undefined>>;
}) => void;

const RouterContext = globalRouterContext[ROUTER_CONTEXT_SYMBOL] ??
  (globalRouterContext[ROUTER_CONTEXT_SYMBOL] = React.createContext<RouterValue>(defaultRouter));

const PageContextContext = globalPageContext[PAGE_CONTEXT_SYMBOL] ??
  (globalPageContext[PAGE_CONTEXT_SYMBOL] = React.createContext(defaultPageContext));

function isServerEnvironment(): boolean {
  const ssrFlag = (globalThis as Record<string, unknown>).__VERYFRONT_SSR__;
  if (ssrFlag === true) return true;
  return typeof window === "undefined";
}

function getDocumentNonce(): string | undefined {
  if (typeof document === "undefined") return undefined;

  const element = document.querySelector<HTMLElement>("script[nonce], style[nonce], link[nonce]");
  if (!element) return undefined;

  const nonce = element.nonce || element.getAttribute("nonce") || "";
  return nonce || undefined;
}

function collectHead(data: Parameters<CollectHeadFn>[0]): void {
  const collector = (globalThis as typeof globalThis & {
    [HEAD_COLLECTOR_SYMBOL]?: CollectHeadFn;
  })[HEAD_COLLECTOR_SYMBOL];

  collector?.(data);
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

function getNavigationStore(): NavigationStore {
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
 * Client-only reactive router/page provider. `pathname`/`query` track the live
 * URL through the shared navigation store's `useSyncExternalStore` surface;
 * `params`/`frontmatter`/`domain` are seeded from props. Provides both
 * `RouterContext` and `PageContext` so `useRouter()` and `usePageContext()` are
 * reactive.
 *
 * The store is a stable singleton that exists on first access, so there is no
 * "is the router mounted yet?" race: the subscription is live from the first
 * render, and the router's navigations notify through the same object.
 */
function ReactiveRouterProvider({
  children,
  router,
  frontmatter,
}: RouterProviderProps): React.ReactElement {
  const store = getNavigationStore();
  // The server-render snapshot is derived from the router itself, so the first
  // client render matches the server exactly (both come from one `RouterValue`).
  const seedHref = hrefFromRouter(router) ?? "/";
  const getServerSnapshot = React.useCallback(() => seedHref, [seedHref]);

  const href = React.useSyncExternalStore(store.subscribe, store.getHref, getServerSnapshot);
  const { pathname, search } = splitHref(href);

  const query = React.useMemo(
    () => Object.fromEntries(new URLSearchParams(search)) as Record<string, string>,
    [search],
  );

  const seed = router ?? defaultRouter;
  const seedParams = seed.params;
  const seedFrontmatter = frontmatter ?? {};

  const routerValue = React.useMemo<RouterValue>(
    () => ({
      domain: seed.domain || (globalThis.location?.hostname ?? ""),
      path: pathname,
      pathname,
      params: seedParams,
      query,
      isPreview: seed.isPreview,
      isMounted: true,
      navigate: (url: string) => store.navigate(url, { history: "push" }),
      push: (url: string) => store.navigate(url, { history: "push" }),
      replace: (url: string) => store.navigate(url, { history: "replace" }),
      reload: async () => {
        globalThis.location?.reload();
      },
    }),
    [pathname, query, seedParams, seed.domain, seed.isPreview, store],
  );

  const pageContextValue = React.useMemo<PageContextValue>(
    () => ({
      slug: seed.path || pathname,
      path: pathname,
      params: seedParams,
      query,
      frontmatter: seedFrontmatter,
      headings: [],
      mdxHeadings: [],
    }),
    [pathname, query, seedParams, seedFrontmatter, seed.path],
  );

  return React.createElement(
    RouterContext.Provider,
    { value: routerValue },
    React.createElement(PageContextContext.Provider, { value: pageContextValue }, children),
  );
}

/**
 * Provides the router (and, on the client, page) context. On the server it
 * renders the static `router` snapshot verbatim so SSR output and the first
 * client render match. On the client it delegates to `ReactiveRouterProvider`,
 * whose `pathname`/`query` track `veryFrontRouter` — so `useRouter()` and
 * `usePageContext()` re-render on client-side navigation.
 */
export function RouterProvider(props: RouterProviderProps): React.ReactElement {
  if (isServerEnvironment()) {
    return React.createElement(
      RouterContext.Provider,
      { value: props.router ?? defaultRouter },
      props.children,
    );
  }
  return React.createElement(ReactiveRouterProvider, props);
}

/** Options for {@link wrapForHydration}. */
export interface HydrationWrapOptions {
  /** Route params from the initial match. */
  params?: Record<string, string>;
  /** Page frontmatter, exposed reactively through `usePageContext()`. */
  frontmatter?: Record<string, unknown>;
}

/**
 * Wraps a hydrated client component in `RouterProvider`, seeded from the live
 * location plus the initial route match, as one `RouterValue`.
 *
 * The RSC hydration path calls this through a runtime import of
 * `veryfront/router`, so it runs under the app's React instance — the same one
 * the hydrated component uses, and the same `RouterProvider` and `React` this
 * module already reference. That is why the caller does not (and must not) pass
 * a `React` across the module boundary: the wrapping happens here, inside the
 * module that owns React.
 */
export function wrapForHydration(
  child: React.ReactNode,
  options: HydrationWrapOptions = {},
): React.ReactElement {
  const loc = globalThis.location;
  const pathname = loc?.pathname ?? "/";
  const query = loc
    ? (Object.fromEntries(new URLSearchParams(loc.search)) as Record<string, string>)
    : {};
  const router: RouterValue = {
    ...defaultRouter,
    domain: loc?.hostname ?? "",
    path: pathname,
    pathname,
    params: options.params ?? {},
    query,
  };
  return React.createElement(RouterProvider, {
    router,
    frontmatter: options.frontmatter,
    children: child,
  });
}

/**
 * Reads the full router context. Kept as the backward-compatible surface; new
 * code should prefer the granular {@link usePathname} / {@link useSearchParams} /
 * {@link useParams} hooks, which re-render only on the slice they read.
 */
export function useRouter(): RouterValue {
  return React.useContext(RouterContext);
}

/** The current URL pathname. Reactive across client-side navigation. */
export function usePathname(): string {
  return React.useContext(RouterContext).pathname;
}

/** The current route params from the initial match. */
export function useParams(): Record<string, string> {
  return React.useContext(RouterContext).params;
}

/**
 * The current query as a `URLSearchParams` — preserving repeated keys, unlike
 * the flattened `useRouter().query`. Reads the live URL for full fidelity and is
 * reactive through the router context; falls back to the router snapshot's query
 * during SSR, where there is no live location.
 */
export function useSearchParams(): URLSearchParams {
  const { query } = React.useContext(RouterContext);
  const search = globalThis.location?.search;
  return React.useMemo(
    () => new URLSearchParams(search || new URLSearchParams(query).toString()),
    [search, query],
  );
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

/** Provides page context to route and MDX descendants. */
export function PageContextProvider({
  children,
  pageContext,
}: PageContextProviderProps): React.ReactElement {
  return React.createElement(
    PageContextContext.Provider,
    { value: pageContext ?? defaultPageContext },
    children,
  );
}

/** Reads the current page context. */
export function usePageContext(): PageContextValue {
  return React.useContext(PageContextContext);
}

/** Applies document head elements during SSR and client rendering. */
export function Head({ children }: { children: React.ReactNode }): React.ReactElement {
  const isSSR = isServerEnvironment();

  if (isSSR && children) {
    React.Children.forEach(children, (child) => {
      if (!React.isValidElement(child)) return;

      const { type } = child;
      const props = child.props as Record<string, unknown>;
      if (typeof type !== "string" || type === "body") return;

      if (type === "title") {
        collectHead({ title: String(props.children ?? "") });
        return;
      }

      if (type === "meta") {
        collectHead({
          metas: [{
            name: props.name as string | undefined,
            property: props.property as string | undefined,
            content: String(props.content ?? ""),
          }],
        });
        return;
      }

      if (type === "link") {
        const link: Record<string, string> = {};
        for (const [key, value] of Object.entries(props)) {
          if (value != null) link[key] = String(value);
        }
        collectHead({ links: [link] });
        return;
      }

      if (type === "style") {
        collectHead({ styles: [String(props.children ?? "")] });
        return;
      }

      if (type === "script") {
        const script: Record<string, string | undefined> = {};
        for (const [key, value] of Object.entries(props)) {
          if (key === "children" || key === "dangerouslySetInnerHTML") continue;
          if (value != null) script[key] = String(value);
        }
        if (props.dangerouslySetInnerHTML) {
          const html = props.dangerouslySetInnerHTML as { __html?: string };
          if (html.__html) script.content = html.__html;
        } else if (typeof props.children === "string") {
          script.content = props.children;
        }
        collectHead({ scripts: [script] });
      }
    });
  }

  useEffect(() => {
    if (!children) return;

    const addedElements: Element[] = [];
    const nonce = getDocumentNonce();

    React.Children.forEach(children, (child) => {
      if (!React.isValidElement(child)) return;

      const { type } = child;
      const props = child.props as Record<string, unknown>;
      if (typeof type !== "string" || type === "body") return;

      if (type === "title") {
        document.title = String(props.children ?? "");
        return;
      }

      const element = document.createElement(type);
      if ((type === "style" || type === "script") && !props.nonce && nonce) {
        element.setAttribute("nonce", nonce);
      }

      if (type === "script") {
        const src = props.src as string | undefined;
        const id = props.id as string | undefined;

        if (id && document.querySelector(`script[data-vf-head][id="${id}"]`)) return;
        if (src && document.querySelector(`script[data-vf-head][src="${src}"]`)) return;

        const content = typeof props.children === "string"
          ? props.children
          : (props.dangerouslySetInnerHTML as { __html?: string })?.__html;
        if (content && !id) {
          let sum = 0;
          for (let i = 0; i < Math.min(content.length, 200); i++) {
            sum = ((sum << 5) - sum + content.charCodeAt(i)) | 0;
          }
          const hash = `vf${Math.abs(sum).toString(36)}`;
          if (document.querySelector(`script[data-vf-head][data-vf-hash="${hash}"]`)) return;
          element.setAttribute("data-vf-hash", hash);
        }
        element.setAttribute("data-vf-head", "true");
      }

      for (const [key, value] of Object.entries(props)) {
        if (key === "children") continue;

        let attrName = key;
        if (key === "className") attrName = "class";
        else if (key === "htmlFor") attrName = "for";

        if (typeof value === "boolean") {
          if (value) element.setAttribute(attrName, "");
          continue;
        }

        if (value != null) element.setAttribute(attrName, String(value));
      }

      if (typeof props.children === "string") {
        element.textContent = props.children;
      }

      element.setAttribute("data-veryfront-managed", "1");
      document.head.appendChild(element);
      addedElements.push(element);
    });

    return () => {
      for (const el of addedElements) el.remove();
    };
  }, [children]);

  return React.createElement("div", {
    "data-veryfront-head": "1",
    style: { display: "none" },
  });
}

export { RouterProvider as Router };
