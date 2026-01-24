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
  components?: Record<string, unknown>;
  pageData?: Record<string, unknown>;
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
