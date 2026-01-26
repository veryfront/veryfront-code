import * as BundledReact from "react";
import type { RuntimeAdapter } from "../../../platform/adapters/base.js";
import type { LayoutItem, MdxBundle, MDXComponents } from "../../../types/index.js";
import type { ImportMapConfig } from "../../../modules/import-map/types.js";
export interface LayoutComponentCache {
    get(key: string): BundledReact.ComponentType | undefined;
    set(key: string, value: BundledReact.ComponentType): void;
    delete(key: string): void;
    clear(): void;
}
export declare function createLayoutComponentCache(maxEntries?: number): LayoutComponentCache;
export declare function loadTSXComponent(componentPath: string, projectDir: string, cache: LayoutComponentCache, adapter: RuntimeAdapter, projectId: string, contentSourceId: string): Promise<BundledReact.ComponentType>;
/** Load an MDX layout module from a bundle. */
export declare function loadMDXLayout(bundle: MdxBundle, projectDir: string, adapter: RuntimeAdapter, projectId: string, projectSlug: string, contentSourceId: string, preloadedImportMap?: ImportMapConfig): Promise<BundledReact.ComponentType<{
    components?: MDXComponents;
}> | undefined>;
/** Preload an MDX layout module into cache for faster subsequent loads. */
export declare function preloadMDXLayoutModule(bundle: MdxBundle, projectDir: string, adapter: RuntimeAdapter, projectId: string, projectSlug: string, contentSourceId: string): Promise<void>;
export declare function applyTSXLayout(element: BundledReact.ReactElement, item: LayoutItem, tsxLayoutModuleCache: LayoutComponentCache, projectDir: string, adapter: RuntimeAdapter, props: Record<string, unknown> | undefined, projectId: string, contentSourceId: string): Promise<BundledReact.ReactElement>;
export declare function applyMDXLayout(element: BundledReact.ReactElement, bundle: MdxBundle, projectDir: string, mergedComponents: MDXComponents, adapter: RuntimeAdapter, projectId: string, projectSlug: string, contentSourceId: string, preloadedImportMap?: ImportMapConfig): Promise<BundledReact.ReactElement>;
//# sourceMappingURL=component-loader.d.ts.map