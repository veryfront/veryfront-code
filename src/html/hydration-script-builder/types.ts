export interface HydrationLayout {
  kind: "mdx" | "tsx";
  path: string;
}

export interface HydrationDataStructure {
  slug: string;
  props: Record<string, unknown>;
  params: Record<string, string | string[]>;
  layouts: HydrationLayout[];
  appPath?: string;
  pagePath?: string;
  pageType?: "mdx" | "md" | "tsx" | "jsx" | "ts" | "js";
  frontmatter?: Record<string, unknown>;
  layoutProps?: Record<string, Record<string, unknown>>;
  /**
   * Whether running in development mode.
   * In dev mode, client uses createRoot instead of hydrateRoot to avoid
   * hydration mismatches from compilation differences between SSR and client.
   */
  dev?: boolean;
  /** Headings extracted from MDX for sidebar/TOC navigation */
  headings?: Array<{ id: string; text: string; level: number }>;
  /** Whether page is embedded in Studio iframe (enables node position data) */
  studioEmbed?: boolean;
}
