import type { ClientModuleStrategy } from "#veryfront/rendering/rsc/client-module-strategy.ts";

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
  /** Project-relative directory that contains App Router routes. */
  appRouterRoot?: string;
  /** The page and advertised client layouts mount inside a server-owned layout island. */
  isolatedClientPage?: boolean;
  pagePath?: string;
  pageType?: "mdx" | "md" | "tsx" | "jsx" | "ts" | "js";
  clientModuleStrategy?: ClientModuleStrategy;
  /** Production release id used to version fallback module URLs. */
  releaseId?: string;
  /** Production release asset URLs keyed by logical source path. */
  releaseAssetModules?: Record<string, string>;
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
