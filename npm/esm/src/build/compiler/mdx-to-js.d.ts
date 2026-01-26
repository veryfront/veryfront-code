import type { RuntimeAdapter } from "../../platform/adapters/base.js";
export interface MDXFrontmatter {
    title?: string;
    description?: string;
    layout?: boolean;
    [key: string]: unknown;
}
export interface CompileToJSOptions {
    projectDir: string;
    mode: "development" | "production";
    components?: string[];
    adapter: RuntimeAdapter;
}
/**
 * Compile MDX to a standalone JS module
 */
export declare function compileMDXToJS(mdxPath: string, mdxContent: string, options: CompileToJSOptions): Promise<{
    code: string;
    frontmatter: MDXFrontmatter;
}>;
export declare function compileMDXFile(mdxPath: string, outputDir: string, options: CompileToJSOptions): Promise<void>;
export declare function compileProjectMDX(projectDir: string, outputDir: string, options: Omit<CompileToJSOptions, "projectDir">): Promise<void>;
//# sourceMappingURL=mdx-to-js.d.ts.map