import type { RuntimeAdapter } from "../../../../platform/adapters/base.js";
export interface FileResolutionResult {
    sourceCode: string;
    actualFilePath: string;
}
export declare function resolveModuleFile(normalizedPath: string, adapter: RuntimeAdapter, projectDir?: string): Promise<FileResolutionResult | null>;
export declare function resolveFileWithExtension(relativePath: string, readFile: (path: string) => Promise<string | null>): Promise<{
    content: string;
    resolvedPath: string;
    extension: string;
} | null>;
//# sourceMappingURL=file-finder.d.ts.map