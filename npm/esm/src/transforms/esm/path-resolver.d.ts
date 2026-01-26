export interface BlockExternalUrlResult {
    code: string;
    blockedUrls: string[];
}
export declare function isCrossProjectImport(specifier: string): boolean;
export declare function parseCrossProjectImport(specifier: string): {
    projectSlug: string;
    version: string;
    path: string;
} | null;
export interface CrossProjectImportOptions {
    apiBaseUrl?: string;
    ssr?: boolean;
}
export declare function resolveCrossProjectImports(code: string, options: CrossProjectImportOptions): Promise<string>;
export declare function blockExternalUrlImports(code: string, _filePath: string): Promise<BlockExternalUrlResult>;
export declare function resolveVeryfrontImports(code: string): Promise<string>;
export declare function resolveVeryfrontSubpathImports(code: string, ssr?: boolean): Promise<string>;
export declare function resolvePathAliases(code: string, filePath: string, projectDir: string, ssr?: boolean): Promise<string>;
export declare function resolveRelativeImports(code: string, filePath: string, projectDir: string, moduleServerUrl?: string): Promise<string>;
export declare function resolveRelativeImportsToAbsolute(code: string, filePath: string, _projectDir: string): Promise<string>;
export declare function resolveRelativeImportsForNodeSSR(code: string): Promise<string>;
export declare function resolveRelativeImportsForSSR(code: string): Promise<string>;
//# sourceMappingURL=path-resolver.d.ts.map