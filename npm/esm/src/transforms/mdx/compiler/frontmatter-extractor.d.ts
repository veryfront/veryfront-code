export interface FrontmatterExtractionResult {
    body: string;
    frontmatter: Record<string, unknown>;
}
export declare function extractFrontmatter(content: string, providedFrontmatter?: Record<string, unknown>): FrontmatterExtractionResult;
//# sourceMappingURL=frontmatter-extractor.d.ts.map