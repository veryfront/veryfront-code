import { defineError, type ErrorRegistryFragment, type RegisteredError } from "../types.ts";

/** Registered error definition for the unknown-error slug. */
export const UNKNOWN_ERROR: RegisteredError = defineError({
  slug: "unknown-error",
  category: "GENERAL",
  status: 500,
  title: "Unknown/unclassified error",
  suggestion: "Check logs for more details",
});

/** Registered error definition for the permission-denied slug. */
export const PERMISSION_DENIED: RegisteredError = defineError({
  slug: "permission-denied",
  category: "GENERAL",
  status: 403,
  title: "File/resource permission denied",
  suggestion: "Check file permissions and access rights",
});

/** Registered error definition for the file-not-found slug. */
export const FILE_NOT_FOUND: RegisteredError = defineError({
  slug: "file-not-found",
  category: "GENERAL",
  status: 404,
  title: "File not found",
  suggestion: "Verify the file path exists",
});

/** Registered error definition for the resource-not-found slug. */
export const RESOURCE_NOT_FOUND: RegisteredError = defineError({
  slug: "resource-not-found",
  category: "GENERAL",
  status: 404,
  title: "Requested resource not found",
  suggestion: "Verify the referenced resource ID or name exists",
});

/** Registered error definition for the invalid-argument slug. */
export const INVALID_ARGUMENT: RegisteredError = defineError({
  slug: "invalid-argument",
  category: "GENERAL",
  status: 400,
  title: "Invalid function argument",
  suggestion: "Check argument types and values",
});

/** Registered error definition for the timeout-error slug. */
export const TIMEOUT_ERROR: RegisteredError = defineError({
  slug: "timeout-error",
  category: "GENERAL",
  status: 408,
  title: "Operation timed out",
  suggestion: "Increase timeout or optimize the operation",
});

/** Registered error definition for the initialization-error slug. */
export const INITIALIZATION_ERROR: RegisteredError = defineError({
  slug: "initialization-error",
  category: "GENERAL",
  status: 500,
  title: "Initialization failed",
  suggestion: "Check initialization requirements and dependencies",
});

/** Registered error definition for the not-supported slug. */
export const NOT_SUPPORTED: RegisteredError = defineError({
  slug: "not-supported",
  category: "GENERAL",
  status: 501,
  title: "Feature not supported",
  suggestion: "Check documentation for supported features",
});

/** Path traversal / secure-fs violations (replaces SecurityError) */
/** Registered error definition for the security-violation slug. */
export const SECURITY_VIOLATION: RegisteredError = defineError({
  slug: "security-violation",
  category: "GENERAL",
  status: 403,
  title: "Security violation detected",
  suggestion: "Check for path traversal or unauthorized access attempts",
});

/** HTTP request input validation failures (replaces ValidationError) */
/** Registered error definition for the input-validation-failed slug. */
export const INPUT_VALIDATION_FAILED: RegisteredError = defineError({
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
export const GENERAL_REGISTRY: ErrorRegistryFragment<
  | "unknown-error"
  | "permission-denied"
  | "file-not-found"
  | "resource-not-found"
  | "invalid-argument"
  | "timeout-error"
  | "initialization-error"
  | "not-supported"
  | "security-violation"
  | "input-validation-failed"
> = Object.freeze(
  {
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
  } as const,
);
