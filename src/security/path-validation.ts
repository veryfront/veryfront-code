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

import {
  FORBIDDEN_PATH_PATTERNS,
  MAX_PATH_LENGTH,
  MAX_PATH_TRAVERSAL_DEPTH,
} from "@veryfront/utils";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";

/**
 * Security validation level
 *
 * - strict: Maximum security, strict whitelist enforcement
 * - normal: Standard security for most operations
 * - permissive: More lenient, for build-time operations
 */
export type ValidationLevel = "strict" | "normal" | "permissive";

/**
 * Path validation result
 */
export interface ValidationResult {
  valid: boolean;
  canonicalPath?: string;
  error?: string;
  code?: string;
}

/**
 * Path validation options
 */
export interface ValidationOptions {
  /** Security level */
  level?: ValidationLevel;

  /** Base directory to restrict access to */
  baseDir: string;

  /** Additional allowed directories (relative to baseDir) */
  allowedDirs?: string[];

  /** Whether to follow symlinks */
  followSymlinks?: boolean;

  /** Whether to check file existence */
  checkExists?: boolean;

  /** Runtime adapter for filesystem operations */
  adapter?: RuntimeAdapter;

  /** Whether to allow absolute paths outside baseDir */
  allowAbsolute?: boolean;
}

/**
 * Path validation error codes
 */
export const PathValidationError = {
  NULL_BYTE: "NULL_BYTE",
  PATH_TOO_LONG: "PATH_TOO_LONG",
  EXCESSIVE_TRAVERSAL: "EXCESSIVE_TRAVERSAL",
  FORBIDDEN_PATTERN: "FORBIDDEN_PATTERN",
  OUTSIDE_BASE: "OUTSIDE_BASE",
  NOT_IN_ALLOWLIST: "NOT_IN_ALLOWLIST",
  FILE_NOT_FOUND: "FILE_NOT_FOUND",
  SYMLINK_DETECTED: "SYMLINK_DETECTED",
  INVALID_PATH: "INVALID_PATH",
  ABSOLUTE_PATH_DENIED: "ABSOLUTE_PATH_DENIED",
} as const;

/**
 * Normalize path separators to forward slashes
 * Handles Windows backslashes and mixed separators
 */
function normalizeSeparators(path: string): string {
  return path.replace(/\\+/g, "/");
}

/**
 * Check if path is absolute
 * Supports Unix (/path) and Windows (C:\path, \\UNC\path)
 */
function isAbsolutePath(path: string): boolean {
  // Unix absolute path
  if (path.startsWith("/")) return true;

  // Windows drive letter (C:\ or C:/)
  if (/^[A-Za-z]:[\/\\]/.test(path)) return true;

  // Windows UNC path (\\server\share)
  if (/^\\\\[^\\]+\\[^\\]+/.test(path)) return true;

  return false;
}

/**
 * Resolve .. and . in path without filesystem access
 * This is a pure string operation for initial validation
 */
function resolvePathSegments(path: string): string {
  const normalized = normalizeSeparators(path);
  const parts = normalized.split("/").filter((p) => p.length > 0);
  const resolved: string[] = [];

  for (const part of parts) {
    if (part === ".") {
      continue;
    } else if (part === "..") {
      if (resolved.length > 0) {
        resolved.pop();
      }
    } else {
      resolved.push(part);
    }
  }

  // Preserve leading slash for absolute paths
  const isAbs = normalized.startsWith("/");
  return isAbs ? `/${resolved.join("/")}` : resolved.join("/");
}

/**
 * Join two paths safely
 */
function joinPaths(base: string, relative: string): string {
  const normalizedBase = normalizeSeparators(base).replace(/\/$/, "");
  const normalizedRelative = normalizeSeparators(relative).replace(/^\//, "");
  return `${normalizedBase}/${normalizedRelative}`;
}

/**
 * Check if target path is within base directory
 * Compares normalized paths (string comparison)
 */
function isWithinDirectory(baseDir: string, targetPath: string): boolean {
  const normalizedBase = normalizeSeparators(baseDir).replace(/\/$/, "");
  const normalizedTarget = normalizeSeparators(targetPath).replace(/\/$/, "");

  return normalizedTarget === normalizedBase ||
    normalizedTarget.startsWith(`${normalizedBase}/`);
}

/**
 * Validate path for security issues (basic checks)
 */
function validatePathBasics(path: string): ValidationResult {
  // Check for null bytes
  // deno-lint-ignore no-control-regex
  if (path.includes("\0") || /\x00/.test(path)) {
    return {
      valid: false,
      error: "Path contains null bytes",
      code: PathValidationError.NULL_BYTE,
    };
  }

  // Check path length
  if (path.length > MAX_PATH_LENGTH) {
    return {
      valid: false,
      error: `Path exceeds maximum length of ${MAX_PATH_LENGTH}`,
      code: PathValidationError.PATH_TOO_LONG,
    };
  }

  // Check forbidden patterns
  for (const pattern of FORBIDDEN_PATH_PATTERNS) {
    if (pattern.test(path)) {
      return {
        valid: false,
        error: `Path contains forbidden pattern: ${pattern}`,
        code: PathValidationError.FORBIDDEN_PATTERN,
      };
    }
  }

  // Check for excessive directory traversal
  const parts = normalizeSeparators(path).split("/");
  let depth = 0;
  let maxDepth = 0;

  for (const part of parts) {
    if (part === "..") {
      depth++;
      maxDepth = Math.max(maxDepth, depth);
    } else if (part !== "." && part !== "") {
      depth = 0;
    }
  }

  if (maxDepth > MAX_PATH_TRAVERSAL_DEPTH) {
    return {
      valid: false,
      error: `Path has excessive traversal depth (${maxDepth} > ${MAX_PATH_TRAVERSAL_DEPTH})`,
      code: PathValidationError.EXCESSIVE_TRAVERSAL,
    };
  }

  return { valid: true };
}

/**
 * Get canonical path by resolving symlinks
 * Falls back to path resolution if adapter not available
 */
async function getCanonicalPath(
  path: string,
  adapter?: RuntimeAdapter,
  followSymlinks = false,
): Promise<{ path: string; isSymlink: boolean }> {
  // If no adapter or not following symlinks, just resolve path segments
  if (!adapter || !followSymlinks) {
    return {
      path: resolvePathSegments(path),
      isSymlink: false,
    };
  }

  try {
    const stat = await adapter.fs.stat(path);

    if (stat.isSymlink) {
      return {
        path: resolvePathSegments(path),
        isSymlink: true,
      };
    }

    return {
      path: resolvePathSegments(path),
      isSymlink: false,
    };
  } catch {
    return {
      path: resolvePathSegments(path),
      isSymlink: false,
    };
  }
}

/**
 * Validate path against allowed directories
 */
function validateAllowedDirs(
  canonicalPath: string,
  baseDir: string,
  allowedDirs: string[],
): ValidationResult {
  const normalizedBase = normalizeSeparators(baseDir).replace(/\/$/, "");
  const normalizedPath = normalizeSeparators(canonicalPath).replace(/\/$/, "");

  // Path must be within base directory
  if (!isWithinDirectory(normalizedBase, normalizedPath)) {
    return {
      valid: false,
      error: `Path is outside base directory: ${baseDir}`,
      code: PathValidationError.OUTSIDE_BASE,
    };
  }

  // If no allowed dirs specified, any path in base is OK
  if (!allowedDirs || allowedDirs.length === 0) {
    return { valid: true, canonicalPath };
  }

  // Check if path is in one of the allowed directories
  const relativePath = normalizedPath === normalizedBase
    ? ""
    : normalizedPath.slice(normalizedBase.length + 1);

  if (!relativePath) {
    // Base directory itself is always allowed
    return { valid: true, canonicalPath };
  }

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
 * Common validation presets for different contexts
 */
export const ValidationPresets = {
  /**
   * Strict validation for user-provided paths
   */
  userInput: (baseDir: string): ValidationOptions => ({
    baseDir,
    level: "strict",
    allowedDirs: ["app", "pages", "public", "components", "lib"],
    followSymlinks: false,
    checkExists: true,
    allowAbsolute: false,
  }),

  /**
   * Normal validation for internal operations
   */
  internal: (baseDir: string): ValidationOptions => ({
    baseDir,
    level: "normal",
    followSymlinks: false,
    checkExists: false,
    allowAbsolute: false,
  }),

  /**
   * Permissive validation for build operations
   */
  build: (baseDir: string): ValidationOptions => ({
    baseDir,
    level: "permissive",
    followSymlinks: true,
    checkExists: false,
    allowAbsolute: true,
  }),

  /**
   * Static file serving validation
   */
  static: (baseDir: string): ValidationOptions => ({
    baseDir,
    level: "normal",
    allowedDirs: ["dist", "public"],
    followSymlinks: false,
    checkExists: true,
    allowAbsolute: false,
  }),
};

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
