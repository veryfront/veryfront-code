import { defineError } from "./types.ts";

// =============================================================================
// CONFIG - Configuration & environment errors
// =============================================================================

export const CONFIG_NOT_FOUND = defineError({
  slug: "config-not-found",
  category: "CONFIG",
  status: 404,
  title: "Configuration file not found",
  suggestion: "Run 'vf init' to create a configuration file",
});

export const CONFIG_INVALID = defineError({
  slug: "config-invalid",
  category: "CONFIG",
  status: 400,
  title: "Invalid configuration format",
  suggestion: "Check your veryfront.config.ts for syntax errors",
});

export const CONFIG_PARSE_ERROR = defineError({
  slug: "config-parse-error",
  category: "CONFIG",
  status: 400,
  title: "Failed to parse configuration",
  suggestion: "Ensure your configuration file is valid TypeScript/JSON",
});

/** Schema-level config validation (e.g. Zod schema mismatch at runtime) */
export const CONFIG_VALIDATION_ERROR = defineError({
  slug: "config-validation-error",
  category: "CONFIG",
  status: 422,
  title: "Configuration validation failed",
  suggestion: "Check the configuration against the schema requirements",
});

export const CONFIG_TYPE_ERROR = defineError({
  slug: "config-type-error",
  category: "CONFIG",
  status: 400,
  title: "Configuration type mismatch",
  suggestion: "Ensure configuration values match expected types",
});

export const IMPORT_MAP_INVALID = defineError({
  slug: "import-map-invalid",
  category: "CONFIG",
  status: 400,
  title: "Invalid import map configuration",
  suggestion: "Check your import map syntax and paths",
});

export const CORS_CONFIG_INVALID = defineError({
  slug: "cors-config-invalid",
  category: "CONFIG",
  status: 400,
  title: "Invalid CORS configuration",
  suggestion: "Review CORS settings in your configuration",
});

/** Config file validation failures (replaces ConfigValidationError) */
export const CONFIG_VALIDATION_FAILED = defineError({
  slug: "config-validation-failed",
  category: "CONFIG",
  status: 400,
  title: "Configuration validation failed",
  suggestion: "Check configuration values against requirements",
});

// =============================================================================
// BUILD - Build & compilation errors
// =============================================================================

export const BUILD_FAILED = defineError({
  slug: "build-failed",
  category: "BUILD",
  status: 500,
  title: "Build process failed",
  suggestion: "Check the build output for specific errors",
});

export const BUNDLE_ERROR = defineError({
  slug: "bundle-error",
  category: "BUILD",
  status: 500,
  title: "Bundle generation failed",
  suggestion: "Review bundler output for details",
});

export const TYPESCRIPT_ERROR = defineError({
  slug: "typescript-error",
  category: "BUILD",
  status: 500,
  title: "TypeScript compilation error",
  suggestion: "Fix TypeScript errors shown in the output",
});

export const MDX_COMPILE_ERROR = defineError({
  slug: "mdx-compile-error",
  category: "BUILD",
  status: 500,
  title: "MDX compilation failed",
  suggestion: "Check your MDX file syntax",
});

export const ASSET_OPTIMIZATION_ERROR = defineError({
  slug: "asset-optimization-error",
  category: "BUILD",
  status: 500,
  title: "Asset optimization failed",
  suggestion: "Check asset file formats and paths",
});

export const SSG_GENERATION_ERROR = defineError({
  slug: "ssg-generation-error",
  category: "BUILD",
  status: 500,
  title: "Static site generation failed",
  suggestion: "Review SSG configuration and data fetching",
});

export const SOURCEMAP_ERROR = defineError({
  slug: "sourcemap-error",
  category: "BUILD",
  status: 500,
  title: "Source map generation failed",
  suggestion: "Check source map configuration",
});

export const COMPILATION_ERROR = defineError({
  slug: "compilation-error",
  category: "BUILD",
  status: 500,
  title: "Compilation failed",
  suggestion: "Review compiler output for specific errors",
});

// =============================================================================
// RUNTIME - Runtime execution & rendering errors
// =============================================================================

export const HYDRATION_MISMATCH = defineError({
  slug: "hydration-mismatch",
  category: "RUNTIME",
  status: 500,
  title: "Client/server hydration mismatch",
  suggestion: "Ensure server and client render the same content",
});

export const RENDER_ERROR = defineError({
  slug: "render-error",
  category: "RUNTIME",
  status: 500,
  title: "Component render failed",
  suggestion: "Check component for runtime errors",
});

export const COMPONENT_ERROR = defineError({
  slug: "component-error",
  category: "RUNTIME",
  status: 500,
  title: "Component execution error",
  suggestion: "Review component logic and props",
});

export const LAYOUT_NOT_FOUND = defineError({
  slug: "layout-not-found",
  category: "RUNTIME",
  status: 404,
  title: "Layout component not found",
  suggestion: "Ensure layout file exists at the expected path",
});

export const PAGE_NOT_FOUND = defineError({
  slug: "page-not-found",
  category: "RUNTIME",
  status: 404,
  title: "Page component not found",
  suggestion: "Check that the page file exists in the routes directory",
});

export const API_ERROR = defineError({
  slug: "api-error",
  category: "RUNTIME",
  status: 500,
  title: "API route handler error",
  suggestion: "Review API route handler for errors",
});

export const MIDDLEWARE_ERROR = defineError({
  slug: "middleware-error",
  category: "RUNTIME",
  status: 500,
  title: "Middleware execution error",
  suggestion: "Check middleware function for errors",
});

// =============================================================================
// ROUTE - Route definition & resolution errors
// =============================================================================

export const ROUTE_CONFLICT = defineError({
  slug: "route-conflict",
  category: "ROUTE",
  status: 409,
  title: "Conflicting route definitions",
  suggestion: "Rename or reorganize conflicting route files",
});

export const INVALID_ROUTE_FILE = defineError({
  slug: "invalid-route-file",
  category: "ROUTE",
  status: 400,
  title: "Invalid route file structure",
  suggestion: "Ensure route file exports required functions",
});

export const ROUTE_HANDLER_INVALID = defineError({
  slug: "route-handler-invalid",
  category: "ROUTE",
  status: 400,
  title: "Invalid route handler export",
  suggestion: "Export a valid handler function from the route file",
});

export const DYNAMIC_ROUTE_ERROR = defineError({
  slug: "dynamic-route-error",
  category: "ROUTE",
  status: 500,
  title: "Dynamic route parsing failed",
  suggestion: "Check dynamic route segment syntax",
});

export const ROUTE_PARAMS_ERROR = defineError({
  slug: "route-params-error",
  category: "ROUTE",
  status: 400,
  title: "Route parameters invalid",
  suggestion: "Validate route parameter values",
});

export const API_ROUTE_ERROR = defineError({
  slug: "api-route-error",
  category: "ROUTE",
  status: 500,
  title: "API route definition error",
  suggestion: "Review API route configuration",
});

// =============================================================================
// MODULE - Module & import resolution errors
// =============================================================================

export const MODULE_NOT_FOUND = defineError({
  slug: "module-not-found",
  category: "MODULE",
  status: 404,
  title: "Module could not be resolved",
  suggestion: "Check the import path and ensure the module is installed",
});

export const IMPORT_RESOLUTION_ERROR = defineError({
  slug: "import-resolution-error",
  category: "MODULE",
  status: 500,
  title: "Import path resolution failed",
  suggestion: "Verify import paths and module configuration",
});

export const CIRCULAR_DEPENDENCY = defineError({
  slug: "circular-dependency",
  category: "MODULE",
  status: 500,
  title: "Circular dependency detected",
  suggestion: "Refactor imports to break the circular dependency",
});

export const INVALID_IMPORT = defineError({
  slug: "invalid-import",
  category: "MODULE",
  status: 400,
  title: "Invalid import statement",
  suggestion: "Fix import syntax or path",
});

export const DEPENDENCY_MISSING = defineError({
  slug: "dependency-missing",
  category: "MODULE",
  status: 404,
  title: "Required dependency not installed",
  suggestion: "Install the missing dependency with your package manager",
});

export const VERSION_MISMATCH = defineError({
  slug: "version-mismatch",
  category: "MODULE",
  status: 409,
  title: "Dependency version mismatch",
  suggestion: "Update dependencies to compatible versions",
});

// =============================================================================
// SERVER - Server, infrastructure & network errors
// =============================================================================

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

/** Both primary and fallback operations failed (replaces FallbackExecutionError) */
export const FALLBACK_EXHAUSTED = defineError({
  slug: "fallback-exhausted",
  category: "SERVER",
  status: 500,
  title: "Primary and fallback operations both failed",
  suggestion: "Check service availability and connectivity",
});

// =============================================================================
// BOUNDARY - RSC/client boundary violations
// =============================================================================

export const CLIENT_BOUNDARY_VIOLATION = defineError({
  slug: "client-boundary-violation",
  category: "BOUNDARY",
  status: 400,
  title: "Client boundary rule violation",
  suggestion: "Add 'use client' directive or move code to a client component",
});

export const SERVER_ONLY_IN_CLIENT = defineError({
  slug: "server-only-in-client",
  category: "BOUNDARY",
  status: 400,
  title: "Server-only code in client component",
  suggestion: "Move server-only code to a server component",
});

export const CLIENT_ONLY_IN_SERVER = defineError({
  slug: "client-only-in-server",
  category: "BOUNDARY",
  status: 400,
  title: "Client-only code in server component",
  suggestion: "Move client-only code to a client component",
});

export const INVALID_USE_CLIENT = defineError({
  slug: "invalid-use-client",
  category: "BOUNDARY",
  status: 400,
  title: "Invalid 'use client' directive",
  suggestion: "Place 'use client' at the top of the file",
});

export const INVALID_USE_SERVER = defineError({
  slug: "invalid-use-server",
  category: "BOUNDARY",
  status: 400,
  title: "Invalid 'use server' directive",
  suggestion: "Place 'use server' at the top of the file or function",
});

export const RSC_PAYLOAD_ERROR = defineError({
  slug: "rsc-payload-error",
  category: "BOUNDARY",
  status: 500,
  title: "RSC payload serialization error",
  suggestion: "Ensure props are serializable (no functions, symbols, etc.)",
});

// =============================================================================
// DEV - Development-only tooling errors
// =============================================================================

export const HMR_ERROR = defineError({
  slug: "hmr-error",
  category: "DEV",
  status: 500,
  title: "Hot module replacement error",
  suggestion: "Restart the development server",
});

export const DEV_SERVER_ERROR = defineError({
  slug: "dev-server-error",
  category: "DEV",
  status: 500,
  title: "Development server error",
  suggestion: "Check the dev server logs and restart",
});

export const FAST_REFRESH_ERROR = defineError({
  slug: "fast-refresh-error",
  category: "DEV",
  status: 500,
  title: "Fast refresh failed",
  suggestion: "Save the file again or restart the dev server",
});

export const ERROR_OVERLAY_ERROR = defineError({
  slug: "error-overlay-error",
  category: "DEV",
  status: 500,
  title: "Error overlay failed",
  suggestion: "Check browser console for details",
});

export const SOURCE_MAP_ERROR = defineError({
  slug: "source-map-error",
  category: "DEV",
  status: 500,
  title: "Source map loading error",
  suggestion: "Rebuild or clear cache",
});

// =============================================================================
// DEPLOY - Deployment & release errors
// =============================================================================

export const DEPLOYMENT_ERROR = defineError({
  slug: "deployment-error",
  category: "DEPLOY",
  status: 500,
  title: "Deployment process failed",
  suggestion: "Check deployment logs for details",
});

export const PLATFORM_ERROR = defineError({
  slug: "platform-error",
  category: "DEPLOY",
  status: 500,
  title: "Platform-specific error",
  suggestion: "Check platform documentation and requirements",
});

export const ENV_VAR_MISSING = defineError({
  slug: "env-var-missing",
  category: "DEPLOY",
  status: 500,
  title: "Required environment variable missing",
  suggestion: "Set the required environment variable",
});

export const PRODUCTION_BUILD_REQUIRED = defineError({
  slug: "production-build-required",
  category: "DEPLOY",
  status: 400,
  title: "Production build required",
  suggestion: "Run 'vf build' before deploying",
});

// =============================================================================
// AGENT - AI agent & orchestration errors
// =============================================================================

export const AGENT_ERROR = defineError({
  slug: "agent-error",
  category: "AGENT",
  status: 500,
  title: "Agent operation error",
  suggestion: "Check agent configuration and logs",
});

export const AGENT_NOT_FOUND = defineError({
  slug: "agent-not-found",
  category: "AGENT",
  status: 404,
  title: "Agent not found",
  suggestion: "Verify the agent ID exists",
});

export const AGENT_TIMEOUT = defineError({
  slug: "agent-timeout",
  category: "AGENT",
  status: 408,
  title: "Agent operation timed out",
  suggestion: "Increase timeout or simplify the request",
});

export const AGENT_INTENT_ERROR = defineError({
  slug: "agent-intent-error",
  category: "AGENT",
  status: 400,
  title: "Agent intent parsing error",
  suggestion: "Rephrase the request more clearly",
});

export const ORCHESTRATION_ERROR = defineError({
  slug: "orchestration-error",
  category: "AGENT",
  status: 500,
  title: "Multi-agent orchestration error",
  suggestion: "Check agent coordination logic",
});

// =============================================================================
// GENERAL - Cross-cutting errors
// =============================================================================

export const UNKNOWN_ERROR = defineError({
  slug: "unknown-error",
  category: "GENERAL",
  status: 500,
  title: "Unknown/unclassified error",
  suggestion: "Check logs for more details",
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

export const INVALID_ARGUMENT = defineError({
  slug: "invalid-argument",
  category: "GENERAL",
  status: 400,
  title: "Invalid function argument",
  suggestion: "Check argument types and values",
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

// =============================================================================
// Registry exports
// =============================================================================

/**
 * All registered errors for lookup by slug
 */
export const ERROR_REGISTRY = {
  // CONFIG
  "config-not-found": CONFIG_NOT_FOUND,
  "config-invalid": CONFIG_INVALID,
  "config-parse-error": CONFIG_PARSE_ERROR,
  "config-validation-error": CONFIG_VALIDATION_ERROR,
  "config-type-error": CONFIG_TYPE_ERROR,
  "import-map-invalid": IMPORT_MAP_INVALID,
  "cors-config-invalid": CORS_CONFIG_INVALID,
  "config-validation-failed": CONFIG_VALIDATION_FAILED,

  // BUILD
  "build-failed": BUILD_FAILED,
  "bundle-error": BUNDLE_ERROR,
  "typescript-error": TYPESCRIPT_ERROR,
  "mdx-compile-error": MDX_COMPILE_ERROR,
  "asset-optimization-error": ASSET_OPTIMIZATION_ERROR,
  "ssg-generation-error": SSG_GENERATION_ERROR,
  "sourcemap-error": SOURCEMAP_ERROR,
  "compilation-error": COMPILATION_ERROR,

  // RUNTIME
  "hydration-mismatch": HYDRATION_MISMATCH,
  "render-error": RENDER_ERROR,
  "component-error": COMPONENT_ERROR,
  "layout-not-found": LAYOUT_NOT_FOUND,
  "page-not-found": PAGE_NOT_FOUND,
  "api-error": API_ERROR,
  "middleware-error": MIDDLEWARE_ERROR,

  // ROUTE
  "route-conflict": ROUTE_CONFLICT,
  "invalid-route-file": INVALID_ROUTE_FILE,
  "route-handler-invalid": ROUTE_HANDLER_INVALID,
  "dynamic-route-error": DYNAMIC_ROUTE_ERROR,
  "route-params-error": ROUTE_PARAMS_ERROR,
  "api-route-error": API_ROUTE_ERROR,

  // MODULE
  "module-not-found": MODULE_NOT_FOUND,
  "import-resolution-error": IMPORT_RESOLUTION_ERROR,
  "circular-dependency": CIRCULAR_DEPENDENCY,
  "invalid-import": INVALID_IMPORT,
  "dependency-missing": DEPENDENCY_MISSING,
  "version-mismatch": VERSION_MISMATCH,

  // SERVER
  "port-in-use": PORT_IN_USE,
  "server-start-error": SERVER_START_ERROR,
  "cache-error": CACHE_ERROR,
  "file-watch-error": FILE_WATCH_ERROR,
  "request-error": REQUEST_ERROR,
  "service-overloaded": SERVICE_OVERLOADED,
  "cache-path-mismatch": CACHE_PATH_MISMATCH,
  "network-error": NETWORK_ERROR,
  "api-client-error": API_CLIENT_ERROR,
  "token-storage-error": TOKEN_STORAGE_ERROR,
  "cache-invariant-violation": CACHE_INVARIANT_VIOLATION,
  "fallback-exhausted": FALLBACK_EXHAUSTED,

  // BOUNDARY
  "client-boundary-violation": CLIENT_BOUNDARY_VIOLATION,
  "server-only-in-client": SERVER_ONLY_IN_CLIENT,
  "client-only-in-server": CLIENT_ONLY_IN_SERVER,
  "invalid-use-client": INVALID_USE_CLIENT,
  "invalid-use-server": INVALID_USE_SERVER,
  "rsc-payload-error": RSC_PAYLOAD_ERROR,

  // DEV
  "hmr-error": HMR_ERROR,
  "dev-server-error": DEV_SERVER_ERROR,
  "fast-refresh-error": FAST_REFRESH_ERROR,
  "error-overlay-error": ERROR_OVERLAY_ERROR,
  "source-map-error": SOURCE_MAP_ERROR,

  // DEPLOY
  "deployment-error": DEPLOYMENT_ERROR,
  "platform-error": PLATFORM_ERROR,
  "env-var-missing": ENV_VAR_MISSING,
  "production-build-required": PRODUCTION_BUILD_REQUIRED,

  // AGENT
  "agent-error": AGENT_ERROR,
  "agent-not-found": AGENT_NOT_FOUND,
  "agent-timeout": AGENT_TIMEOUT,
  "agent-intent-error": AGENT_INTENT_ERROR,
  "orchestration-error": ORCHESTRATION_ERROR,

  // GENERAL
  "unknown-error": UNKNOWN_ERROR,
  "permission-denied": PERMISSION_DENIED,
  "file-not-found": FILE_NOT_FOUND,
  "invalid-argument": INVALID_ARGUMENT,
  "timeout-error": TIMEOUT_ERROR,
  "initialization-error": INITIALIZATION_ERROR,
  "not-supported": NOT_SUPPORTED,
  "security-violation": SECURITY_VIOLATION,
  "input-validation-failed": INPUT_VALIDATION_FAILED,
} as const;

export type ErrorSlug = keyof typeof ERROR_REGISTRY;

/**
 * Get an error definition by slug
 */
export function getErrorBySlug(slug: ErrorSlug) {
  return ERROR_REGISTRY[slug];
}

/**
 * Get all errors in a category
 */
export function getErrorsByCategory(category: string) {
  return Object.values(ERROR_REGISTRY).filter((error) => error.category === category);
}

/**
 * Get all registered slugs
 */
export function getAllSlugs(): ErrorSlug[] {
  return Object.keys(ERROR_REGISTRY) as ErrorSlug[];
}
