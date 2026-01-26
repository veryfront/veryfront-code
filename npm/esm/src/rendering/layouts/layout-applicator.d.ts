import * as BundledReact from "react";
import type { RuntimeAdapter } from "../../platform/adapters/base.js";
import type { LayoutItem, MdxBundle, MDXComponents } from "../../types/index.js";
import type { EntityInfo } from "../../types/index.js";
import type { VeryfrontConfig } from "../../config/index.js";
import type { ImportMapConfig } from "../../modules/import-map/types.js";
import type { LayoutComponentCache } from "./utils/component-loader.js";
export interface LayoutApplicationOptions {
    projectDir: string;
    projectId: string;
    projectSlug: string;
    contentSourceId: string;
    preloadedImportMap?: ImportMapConfig | null;
    adapter: RuntimeAdapter;
    config: VeryfrontConfig;
    layoutCache: LayoutComponentCache;
    mergedComponents: MDXComponents;
    mode: "development" | "production";
    moduleServerUrl?: string;
    requestUrl?: URL;
    frontmatter?: Record<string, unknown>;
    headings?: Array<{
        id: string;
        text: string;
        level: number;
    }>;
}
export declare class LayoutApplicator {
    private projectDir;
    private adapter;
    private config;
    private layoutCache;
    private mergedComponents;
    private mode;
    private requestUrl?;
    private frontmatter?;
    private headings?;
    private projectId;
    private projectSlug;
    private contentSourceId;
    private preloadedImportMap?;
    constructor(options: LayoutApplicationOptions);
    applyLayouts(pageElement: BundledReact.ReactElement, pageInfo: EntityInfo, layoutBundle: MdxBundle | undefined, nestedLayouts: LayoutItem[], layoutDataMap?: Map<string, Record<string, unknown>>): Promise<BundledReact.ReactElement>;
    private applyLayoutsOnly;
    private wrapWithAppComponent;
    private loadMdxAppComponent;
    private wrapWithReservedComponents;
}
//# sourceMappingURL=layout-applicator.d.ts.map