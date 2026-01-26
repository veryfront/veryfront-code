import * as React from "react";
import type { ComponentProps, EntityInfo, PageBundle } from "../types/index.js";
import type { RuntimeAdapter } from "../platform/adapters/base.js";
import type { VeryfrontConfig } from "../config/index.js";
import { ComponentRegistry } from "./ssr/component-registry.js";
import type { RenderResult } from "./orchestrator/types.js";
export interface PageRenderOptions {
    params?: Record<string, string | string[]>;
    props?: ComponentProps;
    nonce?: string;
    /** Project ID for multi-project SSR module isolation */
    projectId?: string;
    /** Enable node position injection for Studio Navigator */
    studioEmbed?: boolean;
    /** Project slug for HTTP fallback in multi-project mode */
    projectSlug?: string;
    /** Content source identifier for cache isolation (branch name or release ID) */
    contentSourceId?: string;
}
export interface PageBundleResult {
    pageElement?: React.ReactElement;
    pageBundle?: PageBundle;
    clientModuleCode?: string;
    pageModuleType?: "mdx" | "component";
    collectedMetadata: Record<string, unknown>;
    scriptResult?: RenderResult;
}
export declare class PageRenderer {
    private readonly projectDir;
    private readonly mode;
    private readonly config;
    private readonly adapter;
    private readonly componentRegistry;
    private readonly compileMDX;
    private readonly moduleServerUrl?;
    constructor(options: {
        projectDir: string;
        mode: string;
        config: VeryfrontConfig;
        adapter: RuntimeAdapter;
        componentRegistry: ComponentRegistry;
        compileMDX: (content: string, frontmatter?: Record<string, unknown>, filePath?: string) => Promise<PageBundle>;
        moduleServerUrl?: string;
    });
    private getMergedComponents;
    private detectPageType;
    preparePageBundles(pageInfo: EntityInfo, slug: string, cachedModule: RenderResult["pageModule"] | undefined, options?: PageRenderOptions): Promise<PageBundleResult>;
    getPageType(pageInfo: EntityInfo): {
        type: "mdx" | "component" | "script";
        extension: string;
        description: string;
    };
    validatePageBundle(result: PageBundleResult, slug: string): void;
}
//# sourceMappingURL=page-renderer.d.ts.map