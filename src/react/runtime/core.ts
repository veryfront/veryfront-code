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
  /** Router value to expose to descendants. */
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

/** Provides the router context value used by `useRouter()`. */
export function RouterProvider({
  children,
  router,
}: RouterProviderProps): React.ReactElement {
  return React.createElement(
    RouterContext.Provider,
    { value: router ?? defaultRouter },
    children,
  );
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
    { ...rest, "data-prefetch": prefetch ? "true" : undefined },
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
