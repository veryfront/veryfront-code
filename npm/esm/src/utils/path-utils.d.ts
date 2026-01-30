export declare function normalizePath(pathname: string): string;
export declare function joinPath(a: string, b: string): string;
export declare function isWithinDirectory(root: string, target: string): boolean;
/**
 * Get file extension including the dot (e.g., ".ts", ".tsx").
 * Returns empty string if no extension found.
 */
export declare function getExtension(path: string): string;
/**
 * Get file extension without the dot, lowercased (e.g., "ts", "tsx").
 * Returns empty string if no extension found.
 */
export declare function getExtensionName(path: string): string;
export declare function getDirectory(path: string): string;
export declare function hasHashedFilename(path: string): boolean;
/**
 * Get esbuild loader type from file extension
 */
export declare function getEsbuildLoader(filePath: string): "tsx" | "jsx" | "ts" | "js";
export declare function isAbsolutePath(path: string): boolean;
export declare function toBase64Url(s: string): string;
export declare function fromBase64Url(encoded: string): string;
//# sourceMappingURL=path-utils.d.ts.map