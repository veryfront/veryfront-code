import { ErrorCode } from "../error-codes.ts";
import type { PartialErrorCatalog } from "./types.ts";
import { createErrorSolution, createSimpleError } from "./factory.ts";

export const SERVER_ERROR_CATALOG: PartialErrorCatalog = {
  [ErrorCode.PORT_IN_USE]: createErrorSolution(ErrorCode.PORT_IN_USE, {
    title: "Port already in use",
    message: "Another process is using the specified port.",
    steps: [
      "Stop the other process: lsof -i :PORT",
      "Use a different port: veryfront dev --port 3003",
      "Add port to config file",
    ],
    example: `// veryfront.config.js
dev: {
  port: 3003
}`,
  }),

  [ErrorCode.SERVER_START_ERROR]: createSimpleError(
    ErrorCode.SERVER_START_ERROR,
    "Server failed to start",
    "Development server could not start.",
    [
      "Check for port conflicts",
      "Ensure file permissions are correct",
      "Verify configuration is valid",
    ],
  ),

  [ErrorCode.HMR_ERROR]: createSimpleError(
    ErrorCode.HMR_ERROR,
    "Hot Module Replacement error",
    "HMR failed to update module.",
    [
      "Try refreshing the page",
      "Check for syntax errors",
      "Restart dev server if persistent",
    ],
  ),

  [ErrorCode.CACHE_ERROR]: createSimpleError(
    ErrorCode.CACHE_ERROR,
    "Cache operation failed",
    "Error reading or writing cache.",
    [
      "Clear cache: veryfront clean --cache",
      "Check disk space",
      "Verify file permissions",
    ],
  ),

  [ErrorCode.FILE_WATCH_ERROR]: createSimpleError(
    ErrorCode.FILE_WATCH_ERROR,
    "File watching failed",
    "Could not watch files for changes.",
    [
      "Check system file watch limits",
      "Reduce number of watched files",
      "Try restarting dev server",
    ],
  ),

  [ErrorCode.REQUEST_ERROR]: createSimpleError(
    ErrorCode.REQUEST_ERROR,
    "Request handling error",
    "Error processing HTTP request.",
    [
      "Check request format and headers",
      "Verify route handler code",
      "Check for middleware errors",
    ],
  ),
};
