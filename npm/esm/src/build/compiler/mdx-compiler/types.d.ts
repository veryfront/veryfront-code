export interface CompileOptions {
    projectDir: string;
    outputDir: string;
    mode: "development" | "production";
}
export interface MDXFrontmatter {
    title?: string;
    description?: string;
    layout?: boolean;
    [key: string]: unknown;
}
export interface CompileResult {
    outputPath: string;
    frontmatter: MDXFrontmatter;
    imports: string[];
}
export type UnifiedPlugin = unknown | [unknown, ...unknown[]];
export type PluginList = UnifiedPlugin[];
//# sourceMappingURL=types.d.ts.map