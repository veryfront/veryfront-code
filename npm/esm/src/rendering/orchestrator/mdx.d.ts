import type { MdxBundle } from "../../types/index.js";
import type { MDXCacheAdapter } from "../../transforms/mdx/index.js";
export interface MDXCompilerConfig {
    projectDir: string;
    mode: "development" | "production";
    mdxCacheAdapter: MDXCacheAdapter;
    /** Enable node position injection for Studio Navigator */
    studioEmbed?: boolean;
}
type MDXCompileResult = MdxBundle & {
    headings?: Array<{
        id: string;
        text: string;
        level: number;
    }>;
    nodeMap?: Map<number, unknown>;
};
export declare class MDXCompiler {
    private config;
    constructor(config: MDXCompilerConfig);
    compileMDX(content: string, frontmatter?: Record<string, unknown>, filePath?: string): Promise<MDXCompileResult>;
    private compileAndCache;
}
export {};
//# sourceMappingURL=mdx.d.ts.map