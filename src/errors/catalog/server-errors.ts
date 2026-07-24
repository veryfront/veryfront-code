import type { PartialErrorCatalog } from "./types.ts";
import { createErrorSolution, createSimpleError } from "./factory.ts";

export const SERVER_ERROR_CATALOG: PartialErrorCatalog = Object.freeze({
  "port-in-use": createErrorSolution("port-in-use", {
    title: "Port already in use",
    message: "Another process is using the specified port.",
    steps: [
      "Stop the other process: lsof -i :PORT",
      "Use a different port: veryfront dev --port 3003",
      "Add port to config file",
    ],
    example: `// veryfront.config.ts
dev: {
  port: 3003
}`,
  }),

  "server-start-error": createSimpleError(
    "server-start-error",
    "Server failed to start",
    "Development server could not start.",
    [
      "Check for port conflicts",
      "Ensure file permissions are correct",
      "Verify configuration is valid",
    ],
  ),

  "cache-error": createSimpleError(
    "cache-error",
    "Cache operation failed",
    "Error reading or writing cache.",
    [
      "Clear cache: veryfront clean --cache",
      "Check disk space",
      "Verify file permissions",
    ],
  ),

  "cache-path-mismatch": createErrorSolution("cache-path-mismatch", {
    title: "Cache path mismatch",
    message: "Cached code contains file paths from a different environment.",
    steps: [
      "Stop any Veryfront processes that may still be using the stale cache",
      "Clear the project cache with the public CLI command shown below",
      "Rebuild the project in the environment where it will run",
      "If a shared cache is configured, use that provider's documented invalidation workflow",
    ],
    example: `veryfront clean --cache
veryfront build`,
  }),

  "file-watch-error": createSimpleError(
    "file-watch-error",
    "File watching failed",
    "Could not watch files for changes.",
    [
      "Check system file watch limits",
      "Reduce number of watched files",
      "Try restarting dev server",
    ],
  ),

  "request-error": createSimpleError(
    "request-error",
    "Request handling error",
    "Error processing HTTP request.",
    [
      "Check request format and headers",
      "Verify route handler code",
      "Check for middleware errors",
    ],
  ),

  "service-overloaded": createSimpleError(
    "service-overloaded",
    "Service overloaded",
    "Server is under heavy load.",
    [
      "Reduce request rate",
      "Scale up resources if possible",
      "Check for resource leaks",
    ],
  ),

  "network-error": createSimpleError(
    "network-error",
    "Network operation failed",
    "Failed to complete network request.",
    [
      "Check network connectivity",
      "Verify URL is correct",
      "Check for firewall or proxy issues",
    ],
  ),
});
