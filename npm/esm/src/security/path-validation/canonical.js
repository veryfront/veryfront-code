/**
 * Canonical Path Resolution
 * @module security/path-validation/canonical
 */
import { isWithinDirectory, normalizeSeparators, resolvePathSegments } from "./normalization.js";
import { PathValidationError } from "./types.js";
/**
 * Get canonical path by resolving symlinks
 * Falls back to path resolution if adapter not available
 *
 * Note: This function is intentionally not traced - it's a fast synchronous
 * path operation (< 1ms) and tracing adds noise without value.
 */
export async function getCanonicalPath(path, adapter, followSymlinks = false) {
    const resolvedPath = resolvePathSegments(path);
    if (!adapter || !followSymlinks) {
        return { path: resolvedPath, isSymlink: false };
    }
    try {
        const stat = await adapter.fs.stat(path);
        return { path: resolvedPath, isSymlink: stat.isSymlink };
    }
    catch {
        return { path: resolvedPath, isSymlink: false };
    }
}
/**
 * Validate path against allowed directories
 */
export function validateAllowedDirs(canonicalPath, baseDir, allowedDirs) {
    const normalizedBase = resolvePathSegments(normalizeSeparators(baseDir)).replace(/\/$/, "");
    const normalizedPath = resolvePathSegments(normalizeSeparators(canonicalPath)).replace(/\/$/, "");
    if (!isWithinDirectory(normalizedBase, normalizedPath)) {
        return {
            valid: false,
            error: `Path is outside base directory: ${baseDir}`,
            code: PathValidationError.OUTSIDE_BASE,
        };
    }
    if (!allowedDirs?.length) {
        return { valid: true, canonicalPath };
    }
    if (normalizedPath === normalizedBase) {
        return { valid: true, canonicalPath };
    }
    const relativePath = normalizedPath.slice(normalizedBase.length + 1);
    const topLevelDir = relativePath.split("/")[0] ?? "";
    if (!topLevelDir || !allowedDirs.includes(topLevelDir)) {
        return {
            valid: false,
            error: `Access to directory '${topLevelDir}' not allowed. Allowed: ${allowedDirs.join(", ")}`,
            code: PathValidationError.NOT_IN_ALLOWLIST,
        };
    }
    return { valid: true, canonicalPath };
}
