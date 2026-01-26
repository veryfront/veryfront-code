import * as React from "react";
import type { EntityInfo, LayoutItem, MdxBundle, MDXComponents } from "../../types/index.js";
import type { RuntimeAdapter } from "../../platform/adapters/base.js";
import type { VeryfrontConfig } from "../../config/index.js";
import type { ImportMapConfig } from "../../modules/import-map/types.js";
import type { LayoutCollector, LayoutCompiler } from "../layouts/index.js";
import type { LayoutComponentCache } from "../layouts/utils/component-loader.js";
export interface LayoutOrchestratorConfig {
    projectDir: string;
    projectId: string;
    projectSlug: string;
    contentSourceId: string;
    adapter: RuntimeAdapter;
    config: VeryfrontConfig;
    mode: "development" | "production";
    moduleServerUrl?: string;
    layoutCollector: LayoutCollector;
    layoutCompiler: LayoutCompiler;
    layoutCache: LayoutComponentCache;
    componentRegistry: MDXComponents;
}
export interface LayoutCollectionResult {
    layoutBundle: MdxBundle | undefined;
    nestedLayouts: LayoutItem[];
}
export declare class LayoutOrchestrator {
    private config;
    /** Preloaded import map for MDX layout application */
    private _preloadedImportMap;
    constructor(config: LayoutOrchestratorConfig);
    /** Get preloaded import map if available */
    getPreloadedImportMap(): ImportMapConfig | null;
    clearCache(): void;
    collectLayouts(pageInfo: EntityInfo): Promise<LayoutCollectionResult>;
    preloadLayoutModules(nestedLayouts: LayoutItem[]): Promise<void>;
    applyLayoutsAndWrappers(pageElement: React.ReactElement, pageInfo: EntityInfo, layoutBundle: MdxBundle | undefined, nestedLayouts: LayoutItem[], layoutDataMap?: Map<string, Record<string, unknown>>, requestUrl?: URL, frontmatter?: Record<string, unknown>, headings?: Array<{
        id: string;
        text: string;
        level: number;
    }>, projectSlug?: string): Promise<React.ReactElement>;
}
//# sourceMappingURL=layout.d.ts.map