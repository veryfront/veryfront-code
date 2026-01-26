/**
 * Path Normalization Utilities
 * @module security/path-validation/normalization
 */
/**
 * Normalize path separators to forward slashes
 * Handles Windows backslashes and mixed separators
 */
export declare function normalizeSeparators(path: string): string;
/**
 * Check if path is absolute
 * Supports Unix (/path) and Windows (C:\path, \\UNC\path)
 */
export declare function isAbsolutePath(path: string): boolean;
/**
 * Resolve .. and . in path without filesystem access
 * This is a pure string operation for initial validation
 */
export declare function resolvePathSegments(path: string): string;
/**
 * Join two paths safely
 */
export declare function joinPaths(base: string, relative: string): string;
/**
 * Check if target path is within base directory
 * Compares normalized paths (string comparison)
 */
export declare function isWithinDirectory(baseDir: string, targetPath: string): boolean;
//# sourceMappingURL=normalization.d.ts.map