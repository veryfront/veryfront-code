import type { LayoutItem } from "../../types/index.js";
export declare const LAYOUT_EXTENSIONS: readonly ["mdx", "md", "tsx", "jsx", "ts", "js"];
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
//# sourceMappingURL=types.d.ts.map