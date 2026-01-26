import type * as BundledReact from "react";
import type { RuntimeAdapter } from "../platform/adapters/base.js";
import type { EntityInfo, MdxBundle, MDXComponents, PageBundle } from "../types/index.js";
export interface MDXPageResult {
    pageElement: BundledReact.ReactElement;
    pageBundle: PageBundle;
    collectedMetadata: Record<string, unknown>;
}
export declare function handleMDXPage(pageInfo: EntityInfo, slug: string, projectDir: string, mergedComponents: MDXComponents, _compileMDX: (content: string, frontmatter?: Record<string, unknown>, filePath?: string) => Promise<MdxBundle>, adapter: RuntimeAdapter, options?: {
    params?: Record<string, string | string[]>;
    precompiledModule?: string;
    /** Project ID for cache isolation */
    projectId?: string;
    /** Project slug for HTTP fallback in multi-project mode */
    projectSlug?: string;
    /** Enable node position injection for Studio Navigator */
    studioEmbed?: boolean;
    /** Content source identifier for cache isolation (branch name or release ID) */
    contentSourceId?: string;
}): Promise<MDXPageResult>;
//# sourceMappingURL=page-rendering.d.ts.map