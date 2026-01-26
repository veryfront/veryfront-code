/**
 * Path Traversal Protection
 *
 * Centralized path validation to prevent directory traversal attacks.
 * Implements OWASP security guidelines and defense-in-depth principles.
 *
 * Features:
 * - Canonical path resolution (resolves .., symlinks)
 * - Whitelist-based validation
 * - Null byte and special character detection
 * - Cross-platform support (Windows, Unix)
 * - Multiple security levels
 *
 * @module security/path-validation
 */
export { PathValidationError, } from "./types.js";
export { isAbsolutePath, isWithinDirectory, joinPaths, normalizeSeparators, resolvePathSegments, } from "./normalization.js";
export { validatePathBasics } from "./rules.js";
export { getCanonicalPath, validateAllowedDirs } from "./canonical.js";
export { ValidationPresets } from "./presets.js";
import { getCanonicalPath, validateAllowedDirs } from "./canonical.js";
import { isAbsolutePath, joinPaths, normalizeSeparators, resolvePathSegments, } from "./normalization.js";
import { validatePathBasics } from "./rules.js";
import { PathValidationError } from "./types.js";
function getTargetPath(inputPath, baseDir, level, allowAbsolute) {
    const normalized = normalizeSeparators(inputPath);
    if (!isAbsolutePath(normalized)) {
        return { targetPath: joinPaths(baseDir, normalized) };
    }
    if (!allowAbsolute && level === "strict") {
        return {
            valid: false,
            error: "Absolute paths not allowed in strict mode",
            code: PathValidationError.ABSOLUTE_PATH_DENIED,
        };
    }
    return { targetPath: normalized };
}
export async function validatePath(path, options) {
    const { level = "normal", baseDir, allowedDirs = [], followSymlinks = false, checkExists = false, adapter, allowAbsolute = false, } = options;
    const basicResult = validatePathBasics(path);
    if (!basicResult.valid)
        return basicResult;
    const targetResult = getTargetPath(path, baseDir, level, allowAbsolute);
    if ("valid" in targetResult)
        return targetResult;
    const { path: canonicalPath, isSymlink } = await getCanonicalPath(targetResult.targetPath, adapter, followSymlinks);
    if (isSymlink && level === "strict") {
        return {
            valid: false,
            error: "Symlinks not allowed in strict mode",
            code: PathValidationError.SYMLINK_DETECTED,
        };
    }
    const allowResult = validateAllowedDirs(canonicalPath, baseDir, allowedDirs);
    if (!allowResult.valid)
        return allowResult;
    if (checkExists && adapter) {
        try {
            await adapter.fs.stat(canonicalPath);
        }
        catch {
            return {
                valid: false,
                error: `File not found: ${canonicalPath}`,
                code: PathValidationError.FILE_NOT_FOUND,
            };
        }
    }
    return { valid: true, canonicalPath };
}
export function validatePathSync(path, options) {
    const { level = "normal", baseDir, allowedDirs = [], allowAbsolute = false } = options;
    const basicResult = validatePathBasics(path);
    if (!basicResult.valid)
        return basicResult;
    const targetResult = getTargetPath(path, baseDir, level, allowAbsolute);
    if ("valid" in targetResult)
        return targetResult;
    const canonicalPath = resolvePathSegments(targetResult.targetPath);
    return validateAllowedDirs(canonicalPath, baseDir, allowedDirs);
}
export function createValidator(defaultOptions) {
    return (path, overrides) => validatePath(path, { ...defaultOptions, ...overrides });
}
export function sanitizePathForDisplay(path, baseDir) {
    const normalized = normalizeSeparators(path);
    const normalizedBase = normalizeSeparators(baseDir);
    if (normalized.startsWith(normalizedBase)) {
        return normalized.slice(normalizedBase.length).replace(/^\//, "");
    }
    const parts = normalized.split("/");
    return parts.at(-1) || normalized;
}
