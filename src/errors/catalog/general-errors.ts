import type { PartialErrorCatalog } from "./types.ts";
import { createSimpleError } from "./factory.ts";

/** Immutable error-solution catalog fragment. */
export const GENERAL_ERROR_CATALOG: PartialErrorCatalog = Object.freeze({
  "unknown-error": createSimpleError(
    "unknown-error",
    "Unknown error",
    "An unexpected error occurred.",
    [
      "Check error details above",
      "Run 'veryfront doctor' to diagnose",
      "Try restarting the operation",
      "Check GitHub issues for similar problems",
    ],
  ),

  "permission-denied": createSimpleError(
    "permission-denied",
    "Permission denied",
    "Insufficient permissions to perform operation.",
    [
      "Check file/directory permissions",
      "Run with appropriate permissions",
      "Verify user has write access",
    ],
  ),

  "file-not-found": createSimpleError(
    "file-not-found",
    "File not found",
    "Required file does not exist.",
    [
      "Check that file path is correct",
      "Verify file exists in project",
      "Check for typos in file name",
    ],
  ),

  "resource-not-found": createSimpleError(
    "resource-not-found",
    "Resource not found",
    "The requested resource does not exist.",
    [
      "Verify the referenced workflow, run, approval, or tool ID",
      "Check for typos in the resource name",
      "Confirm the resource has not been deleted",
    ],
  ),

  "invalid-argument": createSimpleError(
    "invalid-argument",
    "Invalid argument",
    "Command received invalid argument.",
    [
      "Check command syntax",
      "Verify argument values",
      "Run 'veryfront help <command>' for usage",
    ],
  ),

  "timeout-error": createSimpleError(
    "timeout-error",
    "Operation timed out",
    "Operation took too long to complete.",
    [
      "Check network connectivity",
      "Try increasing timeout if available",
      "Check for very large files",
    ],
  ),

  "initialization-error": createSimpleError(
    "initialization-error",
    "Initialization failed",
    "Veryfront could not initialize a required component.",
    [
      "Check the component configuration",
      "Verify required files and services are available",
      "Run 'veryfront doctor' for project diagnostics",
    ],
  ),

  "not-supported": createSimpleError(
    "not-supported",
    "Feature not supported",
    "The requested operation is not supported in the current runtime.",
    [
      "Check the runtime requirements for the feature",
      "Select a supported runtime or operation",
      "Run 'veryfront schema --json' to inspect available capabilities",
    ],
  ),

  "security-violation": createSimpleError(
    "security-violation",
    "Security policy violation",
    "Veryfront blocked an operation that violated a security boundary.",
    [
      "Use a project-relative path for project file operations",
      "Remove unauthorized network or file access",
      "Review the applicable project security policy",
    ],
  ),

  "input-validation-failed": createSimpleError(
    "input-validation-failed",
    "Input validation failed",
    "The request input does not match the required schema.",
    [
      "Read the reported field path and expected value",
      "Remove unsupported fields",
      "Retry with an input value that matches the schema",
    ],
  ),
});
