import type { LayoutItem } from "@veryfront/types";

/**
 * Supported layout file extensions in priority order.
 * MDX/MD are prioritized for content-first layouts, then TSX/JSX for component layouts.
 */
export const LAYOUT_EXTENSIONS = ["mdx", "md", "tsx", "jsx", "ts", "js"] as const;

export type LayoutExtension = (typeof LAYOUT_EXTENSIONS)[number];

export interface NestedLayoutsResult {
  nestedLayouts: LayoutItem[];
  depsHash: string;
}

export interface LayoutDiscoveryOptions {
  pageFilePath: string;
  rootDir: string;
  projectDir: string;
}
