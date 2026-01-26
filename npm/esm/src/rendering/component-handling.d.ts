import type * as BundledReact from "react";
import type { RuntimeAdapter } from "../platform/adapters/base.js";
import type { EntityInfo, PageBundle } from "../types/index.js";
export interface ComponentPageResult {
    pageElement: BundledReact.ReactElement;
    pageBundle: PageBundle;
}
/**
 * Load and render a TSX/JSX component page
 */
export declare function handleComponentPage(pageInfo: EntityInfo, slug: string, projectDir: string, _componentRegistry: unknown, adapter: RuntimeAdapter, options?: {
    props?: Record<string, unknown>;
    cachedClientModule?: string;
    moduleServerUrl?: string;
    /** Project ID for multi-project SSR module isolation */
    projectId?: string;
    /** Enable node position injection for Studio Navigator */
    studioEmbed?: boolean;
    /** Content source ID for cache isolation (branch name or release ID) */
    contentSourceId?: string;
}): Promise<ComponentPageResult>;
//# sourceMappingURL=component-handling.d.ts.map