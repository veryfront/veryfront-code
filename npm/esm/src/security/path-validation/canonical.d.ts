/**
 * Canonical Path Resolution
 * @module security/path-validation/canonical
 */
import type { RuntimeAdapter } from "../../platform/adapters/base.js";
import { type ValidationResult } from "./types.js";
/**
 * Get canonical path by resolving symlinks
 * Falls back to path resolution if adapter not available
 *
 * Note: This function is intentionally not traced - it's a fast synchronous
 * path operation (< 1ms) and tracing adds noise without value.
 */
export declare function getCanonicalPath(path: string, adapter?: RuntimeAdapter, followSymlinks?: boolean): Promise<{
    path: string;
    isSymlink: boolean;
}>;
/**
 * Validate path against allowed directories
 */
export declare function validateAllowedDirs(canonicalPath: string, baseDir: string, allowedDirs: string[]): ValidationResult;
//# sourceMappingURL=canonical.d.ts.map