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
   * Router value to expose to descendants. On the server (and when no client
   * router is mounted) this static snapshot is used verbatim. On the client it
   * seeds `params`/`domain`/`isPreview` while `pathname`/`query` track the live
   * URL.
   */
  router?: RouterValue;
  /**
   * SSR href (`pathname` + `search`) used as the `useSyncExternalStore` server
   * snapshot so the first client render matches the server. Falls back to the
   * `router` snapshot, then the live location.
   */
  initialHref?: string;
  /**
   * Route params from the initial match. The URL alone cannot derive these, and
   * they only change on a route navigation (which reloads with fresh data), so
   * they are seeded rather than tracked.
   */
  params?: Record<string, string>;
  /** Page frontmatter, exposed reactively through `usePageContext()`. */
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

/** Navigation surface `RouterProvider` subscribes to on the client. */
interface ClientNavigationRouter {
  subscribe: (listener: () => void) => () => void;
  getCurrentHref: () => string;
  navigate: (url: string, pushState?: boolean, replaceState?: boolean) => Promise<void>;
}

/**
 * The mounted client router (`veryFrontRouter`), or `null` on the server / before
 * it boots. Requires the reactive surface added in `rendering/client/router.ts`.
 */
function getClientRouter(): ClientNavigationRouter | null {
  const candidate = (globalThis as { veryFrontRouter?: Partial<ClientNavigationRouter> })
    .veryFrontRouter;
  if (
    candidate &&
    typeof candidate.subscribe === "function" &&
    typeof candidate.getCurrentHref === "function" &&
    typeof candidate.navigate === "function"
  ) {
    return candidate as ClientNavigationRouter;
  }
  return null;
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

const noopSubscribe = (): () => void => () => {};

/**
 * Client-only reactive router/page provider. `pathname`/`query` track the live
 * URL through `veryFrontRouter`'s `useSyncExternalStore` surface; `params`/
 * `frontmatter`/`domain` are seeded from props. Provides both `RouterContext`
 * and `PageContext` so `useRouter()` and `usePageContext()` are reactive.
 */
function ReactiveRouterProvider({
  children,
  router,
  initialHref,
  params,
  frontmatter,
}: RouterProviderProps): React.ReactElement {
  // Re-read the router on every render so a late-booting `veryFrontRouter` is
  // picked up (the mount effect below forces one re-render if it wasn't ready).
  const client = getClientRouter();
  const seedHref = initialHref ?? hrefFromRouter(router) ?? "/";

  const subscribe = client?.subscribe ?? noopSubscribe;
  const getSnapshot = client?.getCurrentHref ?? (() => seedHref);
  const getServerSnapshot = React.useCallback(() => seedHref, [seedHref]);

  const href = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const { pathname, search } = splitHref(href);

  const query = React.useMemo(
    () => Object.fromEntries(new URLSearchParams(search)) as Record<string, string>,
    [search],
  );

  // The router (`veryFrontRouter`) may boot after this first render. If it was
  // not ready, force a single re-render so we subscribe once it is.
  const [, forceUpdate] = React.useState(0);
  React.useEffect(() => {
    if (!client) {
      const id = setTimeout(() => forceUpdate((n) => n + 1), 0);
      return () => clearTimeout(id);
    }
  }, [client]);

  const seed = router ?? defaultRouter;
  const seedParams = params ?? seed.params;
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
      navigate: (url: string) => client?.navigate(url, true) ?? Promise.resolve(),
      push: (url: string) => client?.navigate(url, true) ?? Promise.resolve(),
      replace: (url: string) => client?.navigate(url, false, true) ?? Promise.resolve(),
      reload: async () => {
        globalThis.location?.reload();
      },
    }),
    [pathname, query, seedParams, seed.domain, seed.isPreview, client],
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

/** Reads the current router context. */
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
