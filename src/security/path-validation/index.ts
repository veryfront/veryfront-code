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

// Re-export types
export {
  PathValidationError,
  type ValidationLevel,
  type ValidationOptions,
  type ValidationResult,
} from "./types.ts";

// Re-export normalization utilities
export {
  isAbsolutePath,
  isWithinDirectory,
  joinPaths,
  normalizeSeparators,
  resolvePathSegments,
} from "./normalization.ts";

// Re-export validation rules
export { validatePathBasics } from "./rules.ts";

// Re-export canonical path utilities
export { getCanonicalPath, validateAllowedDirs } from "./canonical.ts";

// Re-export presets
export { ValidationPresets } from "./presets.ts";

// Import for internal use
import { getCanonicalPath, validateAllowedDirs } from "./canonical.ts";
import {
  isAbsolutePath,
  joinPaths,
  normalizeSeparators,
  resolvePathSegments,
} from "./normalization.ts";
import { validatePathBasics } from "./rules.ts";
import { PathValidationError, type ValidationOptions, type ValidationResult } from "./types.ts";

/**
 * Validate a file path for security
 *
 * This is the main validation function that should be used for all file operations.
 * It implements defense-in-depth with multiple layers of validation.
 *
 * @param path - Path to validate (can be relative or absolute)
 * @param options - Validation options
 * @returns Validation result with canonical path if valid
 *
 * @example
 * ```typescript
 * const result = await validatePath("../../../etc/passwd", {
 *   baseDir: "/project",
 *   allowedDirs: ["app", "pages", "public"],
 * });
 *
 * if (!result.valid) {
 *   console.error(`Invalid path: ${result.error}`);
 * }
 * ```
 */
export async function validatePath(
  path: string,
  options: ValidationOptions,
): Promise<ValidationResult> {
  const {
    level = "normal",
    baseDir,
    allowedDirs = [],
    followSymlinks = false,
    checkExists = false,
    adapter,
    allowAbsolute = false,
  } = options;

  // Basic validation
  const basicResult = validatePathBasics(path);
  if (!basicResult.valid) {
    return basicResult;
  }

  // Normalize path
  const normalized = normalizeSeparators(path);

  // Handle absolute paths
  let targetPath: string;
  if (isAbsolutePath(normalized)) {
    if (!allowAbsolute && level === "strict") {
      return {
        valid: false,
        error: "Absolute paths not allowed in strict mode",
        code: PathValidationError.ABSOLUTE_PATH_DENIED,
      };
    }
    targetPath = normalized;
  } else {
    // Relative path - join with base directory
    targetPath = joinPaths(baseDir, normalized);
  }

  // Get canonical path (resolve .., symlinks if enabled)
  const { path: canonicalPath, isSymlink } = await getCanonicalPath(
    targetPath,
    adapter,
    followSymlinks,
  );

  // In strict mode, reject symlinks
  if (isSymlink && level === "strict") {
    return {
      valid: false,
      error: "Symlinks not allowed in strict mode",
      code: PathValidationError.SYMLINK_DETECTED,
    };
  }

  // Validate against allowed directories
  const allowResult = validateAllowedDirs(canonicalPath, baseDir, allowedDirs);
  if (!allowResult.valid) {
    return allowResult;
  }

  // Check file existence if requested
  if (checkExists && adapter) {
    try {
      await adapter.fs.stat(canonicalPath);
    } catch {
      return {
        valid: false,
        error: `File not found: ${canonicalPath}`,
        code: PathValidationError.FILE_NOT_FOUND,
      };
    }
  }

  return {
    valid: true,
    canonicalPath,
  };
}

/**
 * Validate a path synchronously (without filesystem access)
 *
 * This is faster but less secure than validatePath() as it cannot
 * resolve symlinks or check file existence. Use for pre-validation
 * before filesystem operations.
 *
 * @param path - Path to validate
 * @param options - Validation options (adapter is ignored)
 * @returns Validation result
 */
export function validatePathSync(
  path: string,
  options: ValidationOptions,
): ValidationResult {
  const {
    level = "normal",
    baseDir,
    allowedDirs = [],
    allowAbsolute = false,
  } = options;

  // Basic validation
  const basicResult = validatePathBasics(path);
  if (!basicResult.valid) {
    return basicResult;
  }

  // Normalize and resolve path
  const normalized = normalizeSeparators(path);

  let targetPath: string;
  if (isAbsolutePath(normalized)) {
    if (!allowAbsolute && level === "strict") {
      return {
        valid: false,
        error: "Absolute paths not allowed in strict mode",
        code: PathValidationError.ABSOLUTE_PATH_DENIED,
      };
    }
    targetPath = normalized;
  } else {
    targetPath = joinPaths(baseDir, normalized);
  }

  const canonicalPath = resolvePathSegments(targetPath);

  // Validate against allowed directories
  return validateAllowedDirs(canonicalPath, baseDir, allowedDirs);
}

/**
 * Create a validation function with preset options
 *
 * Useful for creating validators for specific contexts.
 *
 * @param defaultOptions - Default validation options
 * @returns Validation function
 *
 * @example
 * ```typescript
 * const validateAppPath = createValidator({
 *   baseDir: "/project",
 *   allowedDirs: ["app", "components", "lib"],
 *   level: "strict",
 * });
 *
 * const result = await validateAppPath("app/page.tsx");
 * ```
 */
export function createValidator(defaultOptions: ValidationOptions) {
  return (path: string, overrides?: Partial<ValidationOptions>): Promise<ValidationResult> => {
    return validatePath(path, { ...defaultOptions, ...overrides });
  };
}

/**
 * Sanitize a path for safe use in error messages
 * Removes potentially sensitive information
 */
export function sanitizePathForDisplay(path: string, baseDir: string): string {
  const normalized = normalizeSeparators(path);
  const normalizedBase = normalizeSeparators(baseDir);

  if (normalized.startsWith(normalizedBase)) {
    return normalized.slice(normalizedBase.length).replace(/^\//, "");
  }

  // For paths outside base, show only filename
  const parts = normalized.split("/");
  return parts[parts.length - 1] || normalized;
}
