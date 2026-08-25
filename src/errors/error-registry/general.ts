import { defineError } from "../types.ts";

export const UNKNOWN_ERROR = defineError({
  slug: "unknown-error",
  category: "GENERAL",
  status: 500,
  title: "Unknown/unclassified error",
  suggestion: "Check logs for more details",
});

export const AUTHENTICATION_REQUIRED = defineError({
  slug: "authentication-required",
  category: "GENERAL",
  status: 401,
  title: "Authentication required",
  suggestion: "Set VERYFRONT_API_TOKEN or run 'veryfront login'",
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

/**
 * A value the caller supplied is not acceptable: a CLI flag, a positional
 * argument, a config field, or a function argument. Exit code 2 is the CLI's
 * "invalid usage" code, so a script can tell a typo from a failed run.
 */
export const INVALID_ARGUMENT = defineError({
  slug: "invalid-argument",
  category: "GENERAL",
  status: 400,
  title: "Invalid argument",
  suggestion: "Check argument types and values",
  exitCode: 2,
});

/** Writing would replace something that is already there. */
export const ALREADY_EXISTS = defineError({
  slug: "already-exists",
  category: "GENERAL",
  status: 409,
  title: "Target already exists",
  suggestion: "Choose a different name, or remove the existing target first",
  exitCode: 1,
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

export const PROJECT_SOURCE_EMPTY = defineError({
  slug: "project-source-empty",
  category: "GENERAL",
  status: 400,
  title: "Project source is empty",
  suggestion: "Add project files or run 'veryfront init'",
});

/** A scope that owns the process working directory was opened inside another one. */
export const NESTED_CWD_SCOPE = defineError({
  slug: "nested-cwd-scope",
  category: "GENERAL",
  status: 500,
  title: "Working directory scope nested inside another",
  suggestion:
    "Do the inner work directly in the outer scope's callback instead of opening a second one",
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
  "authentication-required": AUTHENTICATION_REQUIRED,
  "permission-denied": PERMISSION_DENIED,
  "file-not-found": FILE_NOT_FOUND,
  "resource-not-found": RESOURCE_NOT_FOUND,
  "invalid-argument": INVALID_ARGUMENT,
  "already-exists": ALREADY_EXISTS,
  "timeout-error": TIMEOUT_ERROR,
  "initialization-error": INITIALIZATION_ERROR,
  "not-supported": NOT_SUPPORTED,
  "security-violation": SECURITY_VIOLATION,
  "input-validation-failed": INPUT_VALIDATION_FAILED,
  "project-source-empty": PROJECT_SOURCE_EMPTY,
  "nested-cwd-scope": NESTED_CWD_SCOPE,
} as const;
