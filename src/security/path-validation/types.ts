/**
 * Path Validation Types
 * @module security/path-validation/types
 */

import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";

export type ValidationLevel = "strict" | "normal";

export interface ValidationResult {
  valid: boolean;
  canonicalPath?: string;
  error?: string;
  code?: string;
}

/** Filesystem-independent policy fields shared by physical path presets. */
export interface PathValidationPolicyOptions {
  level?: ValidationLevel;
  baseDir: string;
  allowedDirs?: string[];
  followSymlinks?: boolean;
  checkExists?: boolean;
  allowAbsolute?: boolean;
}

/** Options for physical filesystem admission. */
export interface ValidationOptions extends PathValidationPolicyOptions {
  adapter: RuntimeAdapter;
}

/** Options for lexical containment checks that never inspect a filesystem. */
export interface LexicalPathValidationOptions {
  baseDir: string;
  allowedDirs?: string[];
  allowAbsolute?: boolean;
}

export const PathValidationError = {
  NULL_BYTE: "NULL_BYTE",
  PATH_TOO_LONG: "PATH_TOO_LONG",
  EXCESSIVE_TRAVERSAL: "EXCESSIVE_TRAVERSAL",
  FORBIDDEN_PATTERN: "FORBIDDEN_PATTERN",
  OUTSIDE_BASE: "OUTSIDE_BASE",
  NOT_IN_ALLOWLIST: "NOT_IN_ALLOWLIST",
  FILE_NOT_FOUND: "FILE_NOT_FOUND",
  SYMLINK_DETECTED: "SYMLINK_DETECTED",
  SYMLINK_CAPABILITY_REQUIRED: "SYMLINK_CAPABILITY_REQUIRED",
  INVALID_PATH: "INVALID_PATH",
  ABSOLUTE_PATH_DENIED: "ABSOLUTE_PATH_DENIED",
} as const;
