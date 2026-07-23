import { defineError, type ErrorRegistryFragment, type RegisteredError } from "../types.ts";

/** Registered error definition for the port-in-use slug. */
export const PORT_IN_USE: RegisteredError = defineError({
  slug: "port-in-use",
  category: "SERVER",
  status: 409,
  title: "Server port already in use",
  suggestion: "Use a different port or stop the process using this port",
});

/** Registered error definition for the server-start-error slug. */
export const SERVER_START_ERROR: RegisteredError = defineError({
  slug: "server-start-error",
  category: "SERVER",
  status: 500,
  title: "Server failed to start",
  suggestion: "Check server configuration and port availability",
});

/** Registered error definition for the cache-error slug. */
export const CACHE_ERROR: RegisteredError = defineError({
  slug: "cache-error",
  category: "SERVER",
  status: 500,
  title: "Cache operation failed",
  suggestion: "Clear the cache and try again",
});

/** Registered error definition for the file-watch-error slug. */
export const FILE_WATCH_ERROR: RegisteredError = defineError({
  slug: "file-watch-error",
  category: "SERVER",
  status: 500,
  title: "File watcher error",
  suggestion: "Restart the development server",
});

/** Registered error definition for the request-error slug. */
export const REQUEST_ERROR: RegisteredError = defineError({
  slug: "request-error",
  category: "SERVER",
  status: 500,
  title: "HTTP request handling error",
  suggestion: "Check request handler and middleware",
});

/** Registered error definition for the service-overloaded slug. */
export const SERVICE_OVERLOADED: RegisteredError = defineError({
  slug: "service-overloaded",
  category: "SERVER",
  status: 503,
  title: "Service overloaded",
  suggestion: "Reduce load or scale up resources",
});

/** Registered error definition for the semaphore-timeout slug. */
export const SEMAPHORE_TIMEOUT: RegisteredError = defineError({
  slug: "semaphore-timeout",
  category: "SERVER",
  status: 503,
  title: "Semaphore acquire timeout",
  suggestion: "Reduce concurrency or increase the semaphore acquire timeout",
});

/** Registered error definition for the circuit-breaker-open slug. */
export const CIRCUIT_BREAKER_OPEN: RegisteredError = defineError({
  slug: "circuit-breaker-open",
  category: "SERVER",
  status: 503,
  title: "Circuit breaker is open",
  suggestion: "Wait for the breaker reset timeout before retrying",
});

/** Registered error definition for the cache-path-mismatch slug. */
export const CACHE_PATH_MISMATCH: RegisteredError = defineError({
  slug: "cache-path-mismatch",
  category: "SERVER",
  status: 500,
  title: "Cache path mismatch",
  suggestion: "Clear the cache directory and rebuild",
});

/** Registered error definition for the network-error slug. */
export const NETWORK_ERROR: RegisteredError = defineError({
  slug: "network-error",
  category: "SERVER",
  status: 502,
  title: "Network operation failed",
  suggestion: "Check network connectivity and retry",
});

/** API client request/response errors (replaces VeryfrontAPIError) */
/** Registered error definition for the api-client-error slug. */
export const API_CLIENT_ERROR: RegisteredError = defineError({
  slug: "api-client-error",
  category: "SERVER",
  status: 500,
  title: "API client request failed",
  suggestion: "Check API connectivity and authentication",
});

/** Token storage adapter failures (replaces TokenStorageError) */
/** Registered error definition for the token-storage-error slug. */
export const TOKEN_STORAGE_ERROR: RegisteredError = defineError({
  slug: "token-storage-error",
  category: "SERVER",
  status: 500,
  title: "Token storage operation failed",
  suggestion: "Check token storage backend and credentials",
});

/** Cache path invariant violations (replaces CacheInvariantError) */
/** Registered error definition for the cache-invariant-violation slug. */
export const CACHE_INVARIANT_VIOLATION: RegisteredError = defineError({
  slug: "cache-invariant-violation",
  category: "SERVER",
  status: 500,
  title: "Cache path invariant violated",
  suggestion: "Clear the cache and rebuild",
});

/** Production domain resolved but no active release found */
/** Registered error definition for the release-not-found slug. */
export const RELEASE_NOT_FOUND: RegisteredError = defineError({
  slug: "release-not-found",
  category: "SERVER",
  status: 404,
  title: "No active release found",
  suggestion: "Deploy the project to create a release for this environment",
});

/** Both primary and fallback operations failed (replaces FallbackExecutionError) */
/** Registered error definition for the fallback-exhausted slug. */
export const FALLBACK_EXHAUSTED: RegisteredError = defineError({
  slug: "fallback-exhausted",
  category: "SERVER",
  status: 500,
  title: "Primary and fallback operations both failed",
  suggestion: "Check service availability and connectivity",
});

/** Registry fragment for SERVER errors (slug → definition). */
export const SERVER_REGISTRY: ErrorRegistryFragment<
  | "port-in-use"
  | "server-start-error"
  | "cache-error"
  | "file-watch-error"
  | "request-error"
  | "service-overloaded"
  | "semaphore-timeout"
  | "circuit-breaker-open"
  | "cache-path-mismatch"
  | "network-error"
  | "api-client-error"
  | "token-storage-error"
  | "cache-invariant-violation"
  | "release-not-found"
  | "fallback-exhausted"
> = Object.freeze(
  {
    "port-in-use": PORT_IN_USE,
    "server-start-error": SERVER_START_ERROR,
    "cache-error": CACHE_ERROR,
    "file-watch-error": FILE_WATCH_ERROR,
    "request-error": REQUEST_ERROR,
    "service-overloaded": SERVICE_OVERLOADED,
    "semaphore-timeout": SEMAPHORE_TIMEOUT,
    "circuit-breaker-open": CIRCUIT_BREAKER_OPEN,
    "cache-path-mismatch": CACHE_PATH_MISMATCH,
    "network-error": NETWORK_ERROR,
    "api-client-error": API_CLIENT_ERROR,
    "token-storage-error": TOKEN_STORAGE_ERROR,
    "cache-invariant-violation": CACHE_INVARIANT_VIOLATION,
    "release-not-found": RELEASE_NOT_FOUND,
    "fallback-exhausted": FALLBACK_EXHAUSTED,
  } as const,
);
