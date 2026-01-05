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
  /**
   * Whether running in development mode.
   * In dev mode, client uses createRoot instead of hydrateRoot to avoid
   * hydration mismatches from compilation differences between SSR and client.
   */
  dev?: boolean;
}
