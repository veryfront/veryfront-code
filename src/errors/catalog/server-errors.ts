import type { PartialErrorCatalog } from "./types.ts";
import { createErrorSolution, createSimpleError } from "./factory.ts";

export const SERVER_ERROR_CATALOG: PartialErrorCatalog = {
  "port-in-use": createErrorSolution("port-in-use", {
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

  "hmr-error": createSimpleError(
    "hmr-error",
    "Hot Module Replacement error",
    "HMR failed to update module.",
    [
      "Try refreshing the page",
      "Check for syntax errors",
      "Restart dev server if persistent",
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
};
