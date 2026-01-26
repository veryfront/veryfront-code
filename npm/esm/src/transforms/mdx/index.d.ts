import React from "react";
import type { MDXComponents, MDXFrontmatter, MDXGlobals, MDXModule } from "./types.js";
export interface MDXRenderOptions {
    components?: MDXComponents;
    frontmatter?: MDXFrontmatter;
    globals?: MDXGlobals;
    extractLayout?: boolean;
    children?: React.ReactNode;
}
export declare class MDXRenderer {
    private moduleCache;
    clearCache(): void;
    loadModuleESM(compiledProgramCode: string, adapter?: import("../../platform/adapters/base.js").RuntimeAdapter, projectId?: string, projectDir?: string, projectSlug?: string, contentSourceId?: string): Promise<MDXModule>;
    render(_compiledCode: string, _options?: MDXRenderOptions): React.ReactElement;
    private parseMDXCode;
}
export declare const mdxRenderer: MDXRenderer;
export declare function clearMDXRendererCache(): void;
export { MDXCacheAdapter, type MDXCacheAdapterOptions, type MDXCompilationResult, } from "./mdx-cache-adapter.js";
//# sourceMappingURL=index.d.ts.map