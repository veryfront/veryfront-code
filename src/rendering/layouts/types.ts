import type { LayoutItem } from "@veryfront/types";

export interface NestedLayoutsResult {
  nestedLayouts: LayoutItem[];
  depsHash: string;
}

export interface LayoutDiscoveryOptions {
  pageFilePath: string;
  rootDir: string;
  projectDir: string;
}
