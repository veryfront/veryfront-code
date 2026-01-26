import type { MDXFrontmatter } from "./types.js";
export interface ParsedContent {
    frontmatter: MDXFrontmatter;
    content: string;
}
export declare function parseFrontmatter(content: string): Promise<ParsedContent>;
export declare function extractExports(content: string): {
    frontmatter: MDXFrontmatter;
    content: string;
};
//# sourceMappingURL=frontmatter-parser.d.ts.map