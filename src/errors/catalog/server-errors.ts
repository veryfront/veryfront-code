import type { PartialErrorCatalog } from "./types.ts";
import { createErrorSolution, createSimpleError } from "./factory.ts";

/** Immutable error-solution catalog fragment. */
export const SERVER_ERROR_CATALOG: PartialErrorCatalog = Object.freeze({
  "port-in-use": createErrorSolution("port-in-use", {
    title: "Port already in use",
    message: "Another process is using the specified port.",
    steps: [
      "Stop the other process: lsof -i :PORT",
      "Use a different port: veryfront dev --port 3003",
      "Set the project port in veryfront.config.ts",
    ],
    example: `veryfront dev --port 3003`,
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

  "semaphore-timeout": createSimpleError(
    "semaphore-timeout",
    "Concurrency slot timed out",
    "The operation could not acquire a concurrency slot before its deadline.",
    [
      "Reduce concurrent work for the affected operation",
      "Check for operations that do not release resources",
      "Increase the acquire timeout only after measuring expected latency",
    ],
  ),

  "circuit-breaker-open": createSimpleError(
    "circuit-breaker-open",
    "Circuit breaker is open",
    "Veryfront paused calls to a repeatedly failing dependency.",
    [
      "Check whether the dependency is available",
      "Wait for the configured reset interval before retrying",
      "Resolve the underlying failures before increasing retry limits",
    ],
  ),

  "api-client-error": createSimpleError(
    "api-client-error",
    "API client request failed",
    "Veryfront could not complete an API request.",
    [
      "Check network connectivity",
      "Run 'veryfront whoami' to verify the current account",
      "Retry after the remote service is available",
    ],
  ),

  "token-storage-error": createSimpleError(
    "token-storage-error",
    "Token storage failed",
    "Veryfront could not read or update its credential store.",
    [
      "Check that the credential store is available and writable",
      "Run 'veryfront login' to create a fresh credential entry",
      "Do not paste credentials into logs or issue reports",
    ],
  ),

  "cache-invariant-violation": createSimpleError(
    "cache-invariant-violation",
    "Cache invariant violated",
    "A cached artifact does not match the current project environment.",
    [
      "Run 'veryfront clean --cache' in the project",
      "Rebuild the project after clearing the cache",
      "Run 'veryfront doctor' if the mismatch returns",
    ],
  ),

  "release-not-found": createSimpleError(
    "release-not-found",
    "Active release not found",
    "The selected environment does not have an active release.",
    [
      "Check that you selected the intended project and environment",
      "Run 'veryfront deploy' to create a release",
      "Retry the operation after the deployment completes",
    ],
  ),

  "fallback-exhausted": createSimpleError(
    "fallback-exhausted",
    "Primary and fallback operations failed",
    "Neither the primary operation nor its configured fallback succeeded.",
    [
      "Check availability of both configured services",
      "Verify the fallback uses independent resources",
      "Retry only after one of the services recovers",
    ],
  ),
});
