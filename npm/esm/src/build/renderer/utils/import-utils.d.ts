/**
 * Import resolution and extraction utilities
 */
/**
 * Extract import statements from code
 */
export declare function extractImports(code: string): string[];
/**
 * Resolve import path relative to file
 */
export declare function resolveImportPath(importPath: string, fromFile: string, _projectDir: string): string;
/**
 * Find component file with various extensions
 */
export declare function findComponent(basePath: string, _projectDir: string): string | null;
/**
 * Process and update import paths in code
 */
export declare function processImports(code: string, filePath: string, projectDir: string, processImport: (importPath: string) => Promise<string | null>): Promise<string>;
//# sourceMappingURL=import-utils.d.ts.map