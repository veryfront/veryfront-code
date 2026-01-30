/**
 * Import Rewriting Utilities for SSR Module Loader
 *
 * Pure functions that rewrite import specifiers in transformed code
 * to use hashed temp file paths (file:// URLs).
 *
 * @module module-system/react-loader/ssr-module-loader/import-rewriter
 */
/**
 * Rewrite a cross-project import specifier to use a local temp path.
 */
export declare function rewriteCrossProjectImport(transformed: string, specifier: string, tempPath: string): string;
/**
 * Rewrite local imports to use hashed temp paths.
 * This ensures each content version uses its own cached module file.
 */
export declare function rewriteLocalImports(transformed: string, localImportPaths: Map<string, string>, fromFilePath: string, projectDir: string): string;
//# sourceMappingURL=import-rewriter.d.ts.map