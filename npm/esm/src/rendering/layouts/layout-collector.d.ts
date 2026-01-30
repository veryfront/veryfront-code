import type { RuntimeAdapter } from "../../platform/adapters/base.js";
import type { EntityInfo, LayoutItem, MdxBundle } from "../../types/index.js";
import type { VeryfrontConfig } from "../../config/index.js";
import { type LayoutExtension } from "./types.js";
/**
 * FileExistenceChecker is a pure interface for checking file existence.
 * This allows unit testing without mocking the full adapter.
 */
export interface FileExistenceChecker {
    exists(path: string): Promise<boolean>;
}
/**
 * Discovers a components/layout.* file in the given project directory.
 * Returns the full path if found, or null if no layout file exists.
 *
 * This is a pure function that can be unit tested without mocking the full adapter.
 */
export declare function discoverComponentsLayoutPath(projectDir: string, checker: FileExistenceChecker): Promise<string | null>;
/**
 * Result from discovering a components layout file.
 */
export interface ComponentsLayoutDiscoveryResult {
    layoutPath: string;
    extension: LayoutExtension;
}
export interface LayoutCollectionResult {
    layoutBundle: MdxBundle | undefined;
    nestedLayouts: LayoutItem[];
}
export interface LayoutCollectorOptions {
    projectDir: string;
    adapter: RuntimeAdapter;
    config: VeryfrontConfig;
    compileMDX: (content: string, frontmatter?: Record<string, unknown>, filePath?: string) => Promise<MdxBundle>;
}
export declare class LayoutCollector {
    private projectDir;
    private adapter;
    private config;
    private compileMDX;
    constructor(options: LayoutCollectorOptions);
    collectLayouts(pageInfo: EntityInfo): Promise<LayoutCollectionResult>;
    private processLayoutResult;
    private collectNamedLayoutWithPath;
    private collectNestedLayouts;
    private collectLayoutsUnified;
    /**
     * Check for components/layout.* as a fallback when no nested layouts are found.
     * This provides consistent behavior between filesystem and API adapters.
     */
    private checkComponentsLayoutFallback;
    /**
     * Creates a LayoutItem, compiling MDX content if needed.
     */
    private createLayoutItemWithBundle;
}
//# sourceMappingURL=layout-collector.d.ts.map