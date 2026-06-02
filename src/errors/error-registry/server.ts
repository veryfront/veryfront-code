import { defineError } from "../types.ts";

export const PORT_IN_USE = defineError({
  slug: "port-in-use",
  category: "SERVER",
  status: 409,
  title: "Server port already in use",
  suggestion: "Use a different port or stop the process using this port",
});

export const SERVER_START_ERROR = defineError({
  slug: "server-start-error",
  category: "SERVER",
  status: 500,
  title: "Server failed to start",
  suggestion: "Check server configuration and port availability",
});

export const CACHE_ERROR = defineError({
  slug: "cache-error",
  category: "SERVER",
  status: 500,
  title: "Cache operation failed",
  suggestion: "Clear the cache and try again",
});

export const FILE_WATCH_ERROR = defineError({
  slug: "file-watch-error",
  category: "SERVER",
  status: 500,
  title: "File watcher error",
  suggestion: "Restart the development server",
});

export const REQUEST_ERROR = defineError({
  slug: "request-error",
  category: "SERVER",
  status: 500,
  title: "HTTP request handling error",
  suggestion: "Check request handler and middleware",
});

export const SERVICE_OVERLOADED = defineError({
  slug: "service-overloaded",
  category: "SERVER",
  status: 503,
  title: "Service overloaded",
  suggestion: "Reduce load or scale up resources",
});

export const SEMAPHORE_TIMEOUT = defineError({
  slug: "semaphore-timeout",
  category: "SERVER",
  status: 503,
  title: "Semaphore acquire timeout",
  suggestion: "Reduce concurrency or increase the semaphore acquire timeout",
});

export const CIRCUIT_BREAKER_OPEN = defineError({
  slug: "circuit-breaker-open",
  category: "SERVER",
  status: 503,
  title: "Circuit breaker is open",
  suggestion: "Wait for the breaker reset timeout before retrying",
});

export const CACHE_PATH_MISMATCH = defineError({
  slug: "cache-path-mismatch",
  category: "SERVER",
  status: 500,
  title: "Cache path mismatch",
  suggestion: "Clear the cache directory and rebuild",
});

export const NETWORK_ERROR = defineError({
  slug: "network-error",
  category: "SERVER",
  status: 502,
  title: "Network operation failed",
  suggestion: "Check network connectivity and retry",
});

/** API client request/response errors (replaces VeryfrontAPIError) */
export const API_CLIENT_ERROR = defineError({
  slug: "api-client-error",
  category: "SERVER",
  status: 500,
  title: "API client request failed",
  suggestion: "Check API connectivity and authentication",
});

/** Token storage adapter failures (replaces TokenStorageError) */
export const TOKEN_STORAGE_ERROR = defineError({
  slug: "token-storage-error",
  category: "SERVER",
  status: 500,
  title: "Token storage operation failed",
  suggestion: "Check token storage backend and credentials",
});

/** Cache path invariant violations (replaces CacheInvariantError) */
export const CACHE_INVARIANT_VIOLATION = defineError({
  slug: "cache-invariant-violation",
  category: "SERVER",
  status: 500,
  title: "Cache path invariant violated",
  suggestion: "Clear the cache and rebuild",
});

/** Production domain resolved but no active release found */
export const RELEASE_NOT_FOUND = defineError({
  slug: "release-not-found",
  category: "SERVER",
  status: 404,
  title: "No active release found",
  suggestion: "Deploy the project to create a release for this environment",
});

/** Both primary and fallback operations failed (replaces FallbackExecutionError) */
export const FALLBACK_EXHAUSTED = defineError({
  slug: "fallback-exhausted",
  category: "SERVER",
  status: 500,
  title: "Primary and fallback operations both failed",
  suggestion: "Check service availability and connectivity",
});

/** Registry fragment for SERVER errors (slug → definition). */
export const SERVER_REGISTRY = {
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
} as const;
