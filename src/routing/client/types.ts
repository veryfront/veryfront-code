export interface FrontmatterData {
  title?: string;
  description?: string;
  ogTitle?: string;
  [key: string]: unknown;
}

export interface ComponentMap {
  [key: string]: unknown;
}

export interface PageData {
  [key: string]: unknown;
}

export interface RouteData {
  html?: string;
  frontmatter?: FrontmatterData;
  components?: ComponentMap;
  pageData?: PageData;
}

export interface LayoutInfo {
  kind: "mdx" | "tsx";
  path: string;
}

export interface SpaPageData {
  slug: string;
  pagePath: string;
  pageType: "mdx" | "tsx" | "jsx" | "ts" | "js";
  layouts: LayoutInfo[];
  providers: string[];
  frontmatter: Record<string, unknown>;
  props: Record<string, unknown>;
  params: Record<string, string | string[]>;
  layoutProps: Record<string, Record<string, unknown>>;
}
