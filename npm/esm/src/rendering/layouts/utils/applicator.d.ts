import * as BundledReact from "react";
import type { RuntimeAdapter } from "../../../platform/adapters/base.js";
import type { LayoutItem, MdxBundle, MDXComponents } from "../../../types/index.js";
import type { ImportMapConfig } from "../../../modules/import-map/types.js";
import type { LayoutComponentCache } from "./component-loader.js";
export declare function applyLayoutsESM(pageElement: BundledReact.ReactElement, layoutBundle: MdxBundle | undefined, nestedLayouts: LayoutItem[], projectDir: string, mergedComponents: MDXComponents, tsxLayoutModuleCache: LayoutComponentCache, adapter: RuntimeAdapter, layoutDataMap: Map<string, Record<string, unknown>> | undefined, projectId: string, projectSlug: string, contentSourceId: string, preloadedImportMap?: ImportMapConfig): Promise<BundledReact.ReactElement>;
export declare function applyLayoutsFunctionBody(pageElement: BundledReact.ReactElement, layoutBundle: MdxBundle | undefined, nestedLayouts: LayoutItem[], mergedComponents: MDXComponents, tsxLayoutModuleCache: LayoutComponentCache, projectDir: string, adapter: RuntimeAdapter, layoutDataMap: Map<string, Record<string, unknown>> | undefined, projectId: string, projectSlug: string, contentSourceId: string): Promise<BundledReact.ReactElement>;
//# sourceMappingURL=applicator.d.ts.map