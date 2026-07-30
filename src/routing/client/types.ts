export interface FrontmatterData {
  title?: string;
  description?: string;
  ogTitle?: string;
  [key: string]: unknown;
}

export type ComponentMap = Record<string, unknown>;

export interface PageData {
  frontmatter?: FrontmatterData;
  components?: ComponentMap;
  props?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface RouteData {
  html?: string;
  frontmatter?: FrontmatterData;
  components?: ComponentMap;
  pageData?: PageData;
  /** Dependency snapshot identity returned by route-data transports. */
  dependencyPinningCacheKey?: string;
}

export interface LayoutInfo {
  kind: "mdx" | "tsx";
  path: string;
}

export interface SpaPageData {
  slug: string;
  pagePath: string;
  pageType: "mdx" | "md" | "tsx" | "jsx" | "ts" | "js";
  layouts: LayoutInfo[];
  providers: string[];
  frontmatter: Record<string, unknown>;
  props: Record<string, unknown>;
  params: Record<string, string | string[]>;
  layoutProps: Record<string, Record<string, unknown>>;
  /** Dependency snapshot identity returned by the page-data endpoint. */
  dependencyPinningCacheKey?: string;
  /**
   * Set when the route's getServerData called redirect(): the page-data endpoint
   * returns a 200 with this instead of page props, and the client router follows
   * it with a document navigation to `destination`.
   */
  redirect?: { destination: string; permanent?: boolean };
}
