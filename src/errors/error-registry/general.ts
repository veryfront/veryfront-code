import { defineError } from "../types.ts";

export const UNKNOWN_ERROR = defineError({
  slug: "unknown-error",
  category: "GENERAL",
  status: 500,
  title: "Unknown/unclassified error",
  suggestion: "Check logs for more details",
});

export const PERMISSION_DENIED = defineError({
  slug: "permission-denied",
  category: "GENERAL",
  status: 403,
  title: "File/resource permission denied",
  suggestion: "Check file permissions and access rights",
});

export const FILE_NOT_FOUND = defineError({
  slug: "file-not-found",
  category: "GENERAL",
  status: 404,
  title: "File not found",
  suggestion: "Verify the file path exists",
});

export const RESOURCE_NOT_FOUND = defineError({
  slug: "resource-not-found",
  category: "GENERAL",
  status: 404,
  title: "Requested resource not found",
  suggestion: "Verify the referenced resource ID or name exists",
});

export const INVALID_ARGUMENT = defineError({
  slug: "invalid-argument",
  category: "GENERAL",
  status: 400,
  title: "Invalid function argument",
  suggestion: "Check argument types and values",
});

export const TIMEOUT_ERROR = defineError({
  slug: "timeout-error",
  category: "GENERAL",
  status: 408,
  title: "Operation timed out",
  suggestion: "Increase timeout or optimize the operation",
});

export const INITIALIZATION_ERROR = defineError({
  slug: "initialization-error",
  category: "GENERAL",
  status: 500,
  title: "Initialization failed",
  suggestion: "Check initialization requirements and dependencies",
});

export const NOT_SUPPORTED = defineError({
  slug: "not-supported",
  category: "GENERAL",
  status: 501,
  title: "Feature not supported",
  suggestion: "Check documentation for supported features",
});

/** Path traversal / secure-fs violations (replaces SecurityError) */
export const SECURITY_VIOLATION = defineError({
  slug: "security-violation",
  category: "GENERAL",
  status: 403,
  title: "Security violation detected",
  suggestion: "Check for path traversal or unauthorized access attempts",
});

/** HTTP request input validation failures (replaces ValidationError) */
export const INPUT_VALIDATION_FAILED = defineError({
  slug: "input-validation-failed",
  category: "GENERAL",
  status: 400,
  title: "Input validation failed",
  suggestion: "Check request input against validation rules",
});

// =============================================================================
// Registry exports
// =============================================================================

/**
 * All registered errors for lookup by slug
 */

/** Registry fragment for GENERAL errors (slug → definition). */
export const GENERAL_REGISTRY = {
  "unknown-error": UNKNOWN_ERROR,
  "permission-denied": PERMISSION_DENIED,
  "file-not-found": FILE_NOT_FOUND,
  "resource-not-found": RESOURCE_NOT_FOUND,
  "invalid-argument": INVALID_ARGUMENT,
  "timeout-error": TIMEOUT_ERROR,
  "initialization-error": INITIALIZATION_ERROR,
  "not-supported": NOT_SUPPORTED,
  "security-violation": SECURITY_VIOLATION,
  "input-validation-failed": INPUT_VALIDATION_FAILED,
} as const;
