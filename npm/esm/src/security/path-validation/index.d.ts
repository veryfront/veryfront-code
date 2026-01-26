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
export { PathValidationError, type ValidationLevel, type ValidationOptions, type ValidationResult, } from "./types.js";
export { isAbsolutePath, isWithinDirectory, joinPaths, normalizeSeparators, resolvePathSegments, } from "./normalization.js";
export { validatePathBasics } from "./rules.js";
export { getCanonicalPath, validateAllowedDirs } from "./canonical.js";
export { ValidationPresets } from "./presets.js";
import { type ValidationOptions, type ValidationResult } from "./types.js";
export declare function validatePath(path: string, options: ValidationOptions): Promise<ValidationResult>;
export declare function validatePathSync(path: string, options: ValidationOptions): ValidationResult;
export declare function createValidator(defaultOptions: ValidationOptions): (path: string, overrides?: Partial<ValidationOptions>) => Promise<ValidationResult>;
export declare function sanitizePathForDisplay(path: string, baseDir: string): string;
//# sourceMappingURL=index.d.ts.map