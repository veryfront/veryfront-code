import type { LayoutItem } from "#veryfront/types";

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
