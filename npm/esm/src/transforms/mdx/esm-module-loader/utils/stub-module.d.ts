export declare function extractNamedImports(code: string, importStatement: string): string[];
export declare function generateStubCode(modulePath: string, namedImports?: string[]): string;
export declare function createStubModule(modulePath: string, code: string, importStatement: string, esmCacheDir: string): Promise<string | null>;
//# sourceMappingURL=stub-module.d.ts.map