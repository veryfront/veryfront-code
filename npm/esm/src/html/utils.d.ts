import type { VeryfrontConfig } from "../config/types.js";
export declare function buildRootAttributes(slug: string, mode: string, noLayout: boolean): string;
export declare function buildContentAttributes(slug: string, noLayout: boolean, ssrHash?: string): string;
interface DetectedVersions {
    react: string;
    veryfront: string;
}
export declare function detectVersions(projectDir: string): Promise<DetectedVersions>;
export interface BuildImportMapOptions {
    projectDir?: string;
    config?: VeryfrontConfig;
    customImports?: Record<string, string>;
}
export declare function buildImportMapJson(options?: BuildImportMapOptions | Record<string, string>): Promise<string>;
export declare function buildImportMapJsonSync(importMap?: Record<string, string>): string;
export declare function shouldDisableLayout(frontmatter?: Record<string, unknown>): boolean;
export {};
//# sourceMappingURL=utils.d.ts.map