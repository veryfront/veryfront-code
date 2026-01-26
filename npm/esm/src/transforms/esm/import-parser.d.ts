import type { RuntimeAdapter } from "../../platform/adapters/base.js";
export interface LocalImport {
    specifier: string;
    absolutePath: string;
}
export interface CrossProjectImport {
    specifier: string;
    projectSlug: string;
    version: string;
    path: string;
}
export interface MissingImport {
    specifier: string;
    fromFile: string;
    reason: string;
}
export interface ParseLocalImportsResult {
    imports: LocalImport[];
    crossProjectImports: CrossProjectImport[];
    missing: MissingImport[];
}
export declare function parseLocalImports(code: string, filePath: string, projectDir: string, adapter?: RuntimeAdapter): Promise<ParseLocalImportsResult>;
//# sourceMappingURL=import-parser.d.ts.map