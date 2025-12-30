import type { VeryfrontConfig } from "@veryfront/config";

export type { HTMLMetadata, MDXFrontmatter } from "@veryfront/transforms/mdx/types.ts";

export interface HTMLGenerationOptions {
  mode: "development" | "production";
  config: VeryfrontConfig;
  importMap?: Record<string, string>;
  nestedLayouts?: Array<{ kind: string; path?: string; componentPath?: string }>;
  providerPaths?: string[];
  appPath?: string;
  pagePath?: string;
  pageType?: "mdx" | "tsx" | "jsx" | "ts" | "js";
  nonce?: string;
  /** Project directory for resolving package versions */
  projectDir?: string;
  /** Project's globals.css content (overrides default theme variables) */
  globalCSS?: string;
  /** Project's tailwind.config.js content (raw JS, will be converted to browser format) */
  tailwindConfigJs?: string;
  /** Frontmatter for SPA client navigation */
  frontmatter?: Record<string, unknown>;
  /** Props for each layout keyed by layout path */
  layoutProps?: Record<string, Record<string, unknown>>;
}

export type { ImportMapConfig } from "../module-system/import-map/types.ts";

export interface HydrationData {
  slug: string;
  props: Record<string, unknown>;
  params: Record<string, string | string[]>;
  layouts: Array<{ kind: string; path?: string }>;
  providers: string[];
  appPath?: string;
  pagePath?: string;
}
