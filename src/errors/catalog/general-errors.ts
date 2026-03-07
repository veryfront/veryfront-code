import type { PartialErrorCatalog } from "./types.ts";
import { createSimpleError } from "./factory.ts";

export const GENERAL_ERROR_CATALOG: PartialErrorCatalog = {
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
};
