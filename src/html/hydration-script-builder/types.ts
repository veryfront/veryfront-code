export interface HydrationLayout {
  kind: "mdx" | "tsx";
  path: string;
}

export interface HydrationDataStructure {
  slug: string;
  props: Record<string, unknown>;
  params: Record<string, string | string[]>;
  layouts: HydrationLayout[];
  providers: string[];
  appPath?: string;
  pagePath?: string;
  pageType?: "mdx" | "tsx" | "jsx" | "ts" | "js";
  frontmatter?: Record<string, unknown>;
  layoutProps?: Record<string, Record<string, unknown>>;
}
