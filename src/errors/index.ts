/**
 * Structured error system with slug-based registry, RFC 9457 HTTP problem
 * details, error boundaries for HTTP and CLI, and user-friendly formatting.
 *
 * @module errors
 */

export { defineError, VeryfrontError } from "./types.ts";
export type {
  ErrorCategory,
  ErrorCreateOptions,
  ErrorDefinition,
  RegisteredError,
  RFC9457Response,
  VeryfrontErrorOptions,
} from "./types.ts";

// Slug-based error registry (single source of truth)
export {
  // AGENT
  AGENT_ERROR,
  AGENT_INTENT_ERROR,
  AGENT_NOT_FOUND,
  AGENT_TIMEOUT,
  API_CLIENT_ERROR,
  API_ERROR,
  API_ROUTE_ERROR,
  ASSET_OPTIMIZATION_ERROR,
  // BUILD
  BUILD_FAILED,
  BUNDLE_ERROR,
  CACHE_ERROR,
  CACHE_INVARIANT_VIOLATION,
  CACHE_PATH_MISMATCH,
  CIRCULAR_DEPENDENCY,
  // BOUNDARY
  CLIENT_BOUNDARY_VIOLATION,
  CLIENT_ONLY_IN_SERVER,
  COMPILATION_ERROR,
  COMPONENT_ERROR,
  CONFIG_INVALID,
  // CONFIG
  CONFIG_NOT_FOUND,
  CONFIG_PARSE_ERROR,
  CONFIG_TYPE_ERROR,
  CONFIG_VALIDATION_ERROR,
  CONFIG_VALIDATION_FAILED,
  CORS_CONFIG_INVALID,
  DEPENDENCY_MISSING,
  // DEPLOY
  DEPLOYMENT_ERROR,
  DEV_SERVER_ERROR,
  DYNAMIC_ROUTE_ERROR,
  ENV_VAR_MISSING,
  ERROR_OVERLAY_ERROR,
  // Registry
  ERROR_REGISTRY,
  type ErrorSlug,
  FALLBACK_EXHAUSTED,
  FAST_REFRESH_ERROR,
  FILE_NOT_FOUND,
  FILE_WATCH_ERROR,
  getAllSlugs,
  getErrorBySlug,
  getErrorsByCategory,
  // DEV
  HMR_ERROR,
  // RUNTIME
  HYDRATION_MISMATCH,
  IMPORT_MAP_INVALID,
  IMPORT_RESOLUTION_ERROR,
  INITIALIZATION_ERROR,
  INPUT_VALIDATION_FAILED,
  INVALID_ARGUMENT,
  INVALID_IMPORT,
  INVALID_ROUTE_FILE,
  INVALID_USE_CLIENT,
  INVALID_USE_SERVER,
  LAYOUT_NOT_FOUND,
  MDX_COMPILE_ERROR,
  MIDDLEWARE_ERROR,
  // MODULE
  MODULE_NOT_FOUND,
  NETWORK_ERROR,
  NOT_SUPPORTED,
  ORCHESTRATION_ERROR,
  PAGE_NOT_FOUND,
  PERMISSION_DENIED,
  PLATFORM_ERROR,
  // SERVER
  PORT_IN_USE,
  PRODUCTION_BUILD_REQUIRED,
  RENDER_ERROR,
  REQUEST_ERROR,
  // ROUTE
  ROUTE_CONFLICT,
  ROUTE_HANDLER_INVALID,
  ROUTE_PARAMS_ERROR,
  RSC_PAYLOAD_ERROR,
  SECURITY_VIOLATION,
  SERVER_ONLY_IN_CLIENT,
  SERVER_START_ERROR,
  SERVICE_OVERLOADED,
  SOURCE_MAP_ERROR,
  SOURCEMAP_ERROR,
  SSG_GENERATION_ERROR,
  TIMEOUT_ERROR,
  TOKEN_STORAGE_ERROR,
  TYPESCRIPT_ERROR,
  // GENERAL
  UNKNOWN_ERROR,
  VERSION_MISMATCH,
} from "./error-registry.ts";

// RFC 9457 HTTP error utilities
export {
  createErrorHandler,
  createErrorResponse,
  createErrorResponseFromDefinition,
  createProblemResponse,
  errorToResponse,
  formatErrorLog,
  isVeryfrontError,
  PROBLEM_JSON_CONTENT_TYPE,
} from "./http-error.ts";

// Error boundary middleware (HTTP and CLI)
export {
  cliErrorBoundary,
  cliErrorBoundarySync,
  errorToRFC9457Response,
  formatCLIError,
  httpErrorBoundary,
  wrapHandlerWithErrorBoundary,
  wrapUnknownError,
  wrapWithContext,
} from "./middleware/index.ts";

// Structured error logging for observability
export { logError, logErrorWithMessage } from "./logging.ts";
export type { ErrorLogEntry } from "./logging.ts";

// Error tracing integration (OpenTelemetry)
export { attachErrorToActiveSpan, attachErrorToSpan } from "./tracing.ts";

// Error handling utilities
export {
  handleErrorWithFallback,
  handleErrorWithFallbackSync,
  retryWithBackoff,
} from "./error-handlers.ts";

export {
  createErrorScope,
  safeFileRead,
  safeFileStat,
  safeReadDir,
  withErrorContext,
  withErrorContextSync,
} from "./error-context.ts";

export type { ErrorContext, ErrorHandlingOptions, LogLevel } from "./error-context.ts";

export {
  BUILD_ERROR_CATALOG,
  CONFIG_ERROR_CATALOG,
  createErrorSolution,
  createSimpleError,
  DEPLOYMENT_ERROR_CATALOG,
  DEV_ERROR_CATALOG,
  ERROR_CATALOG,
  GENERAL_ERROR_CATALOG,
  getErrorSolution,
  MODULE_ERROR_CATALOG,
  ROUTE_ERROR_CATALOG,
  RSC_ERROR_CATALOG,
  RUNTIME_ERROR_CATALOG,
  searchErrors,
  SERVER_ERROR_CATALOG,
} from "./catalog/index.ts";

export type { ErrorCatalog, ErrorSolution, PartialErrorCatalog } from "./catalog/index.ts";

export {
  ERROR_SOLUTIONS,
  formatUserError,
  identifyError,
  wrapErrorHandler,
} from "./user-friendly/index.ts";

export type { ErrorSolution as UserFriendlyErrorSolution } from "./user-friendly/index.ts";

export { createError, ensureError, getErrorMessage, toError } from "./veryfront-error.ts";
export type { VeryfrontErrorData } from "./veryfront-error.ts";
