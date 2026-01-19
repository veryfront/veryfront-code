/**
 * Path Validation Types
 * @module security/path-validation/types
 */

import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";

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
