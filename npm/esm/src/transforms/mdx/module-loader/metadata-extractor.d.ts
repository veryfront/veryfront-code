import type { FrontmatterMetadata, MDXModule } from "./types.js";
export declare function extractFrontmatter(moduleCode: string): FrontmatterMetadata | undefined;
export declare function extractMetadata(moduleCode: string): Partial<MDXModule>;
export declare function mergeFrontmatter(result: MDXModule): void;
//# sourceMappingURL=metadata-extractor.d.ts.map