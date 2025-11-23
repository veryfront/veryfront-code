import type { VeryfrontConfig } from "@veryfront/config";

export type { HTMLMetadata, MDXFrontmatter } from "@veryfront/transforms/mdx/types.ts";

export interface HTMLGenerationOptions {
  mode: string;
  config: VeryfrontConfig;
  importMap?: Record<string, string>;
  nestedLayouts?: Array<{ kind: string; path?: string; componentPath?: string }>;
  providerPaths?: string[];
  appPath?: string;
  pagePath?: string;
  nonce?: string;
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
