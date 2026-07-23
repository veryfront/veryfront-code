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
  ErrorRegistryFragment,
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
  // Registry
  AGENT_REGISTRY,
  AGENT_TIMEOUT,
  API_CLIENT_ERROR,
  API_ERROR,
  API_ROUTE_ERROR,
  ASSET_OPTIMIZATION_ERROR,
  BOUNDARY_REGISTRY,
  // BUILD
  BUILD_FAILED,
  BUILD_REGISTRY,
  BUNDLE_ERROR,
  CACHE_ERROR,
  CACHE_INVARIANT_VIOLATION,
  CACHE_PATH_MISMATCH,
  CIRCUIT_BREAKER_OPEN,
  CIRCULAR_DEPENDENCY,
  CIRCULAR_DEPENDENCY_ERROR,
  // BOUNDARY
  CLIENT_BOUNDARY_VIOLATION,
  CLIENT_ONLY_IN_SERVER,
  COMPILATION_ERROR,
  COMPONENT_ERROR,
  CONFIG_INVALID,
  // CONFIG
  CONFIG_NOT_FOUND,
  CONFIG_PARSE_ERROR,
  CONFIG_REGISTRY,
  CONFIG_TYPE_ERROR,
  CONFIG_VALIDATION_ERROR,
  CONFIG_VALIDATION_FAILED,
  CORS_CONFIG_INVALID,
  COST_LIMIT_EXCEEDED,
  DEPENDENCY_MISSING,
  DEPLOY_REGISTRY,
  // DEPLOY
  DEPLOYMENT_ERROR,
  DEV_REGISTRY,
  DEV_SERVER_ERROR,
  DYNAMIC_ROUTE_ERROR,
  ENV_VAR_MISSING,
  ERROR_OVERLAY_ERROR,
  ERROR_REGISTRY,
  type ErrorRegistry,
  type ErrorSlug,
  EXTENSION_CONFLICT_ERROR,
  EXTENSION_SETUP_TIMEOUT_ERROR,
  EXTENSION_VALIDATION_ERROR,
  FALLBACK_EXHAUSTED,
  FAST_REFRESH_ERROR,
  FILE_NOT_FOUND,
  FILE_WATCH_ERROR,
  GENERAL_REGISTRY,
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
  MISSING_EXTENSION_ERROR,
  // MODULE
  MODULE_NOT_FOUND,
  MODULE_REGISTRY,
  NETWORK_ERROR,
  NOT_SUPPORTED,
  ORCHESTRATION_ERROR,
  PAGE_NOT_FOUND,
  PERMISSION_DENIED,
  PLATFORM_ERROR,
  // SERVER
  PORT_IN_USE,
  PRODUCTION_BUILD_REQUIRED,
  RELEASE_NOT_FOUND,
  RENDER_ERROR,
  REQUEST_ERROR,
  RESOURCE_NOT_FOUND,
  // ROUTE
  ROUTE_CONFLICT,
  ROUTE_HANDLER_INVALID,
  ROUTE_PARAMS_ERROR,
  ROUTE_REGISTRY,
  RSC_PAYLOAD_ERROR,
  RUNTIME_REGISTRY,
  SCHEDULE_CONFIG_INVALID,
  SECURITY_VIOLATION,
  SEMAPHORE_TIMEOUT,
  SERVER_ONLY_IN_CLIENT,
  SERVER_REGISTRY,
  SERVER_START_ERROR,
  SERVICE_OVERLOADED,
  SOURCE_MAP_ERROR,
  SOURCEMAP_ERROR,
  SSG_GENERATION_ERROR,
  TIMEOUT_ERROR,
  TOKEN_STORAGE_ERROR,
  TOOL_ID_CONFLICT,
  TRIGGER_CONFIG_INVALID,
  TRIGGER_EXECUTION_FAILED,
  TRIGGER_NOT_SUPPORTED,
  TRIGGER_TARGET_NOT_FOUND,
  TYPESCRIPT_ERROR,
  // GENERAL
  UNKNOWN_ERROR,
  VERSION_MISMATCH,
  WEBHOOK_CONFIG_INVALID,
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
  PROBLEM_RESPONSE_HEADERS,
} from "./http-error.ts";
export type { ErrorHandlerContext, ErrorRequestHandler } from "./http-error.ts";

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
export type {
  CLIErrorBoundaryOptions,
  ErrorBoundaryContext,
  ErrorBoundaryHandler,
  ErrorBoundaryResult,
} from "./middleware/index.ts";

// Structured error logging for observability
export { logError, logErrorWithMessage } from "./logging.ts";
export type { ErrorLogEntry } from "./logging.ts";

// Error tracing integration (OpenTelemetry)
export { attachErrorToActiveSpan, attachErrorToSpan } from "./tracing.ts";
export type { ErrorTraceApi, ErrorTraceSpan } from "./tracing.ts";

// Error handling utilities
export {
  handleErrorWithFallback,
  handleErrorWithFallbackSync,
  retryWithBackoff,
} from "./error-handlers.ts";
export type { ErrorHandlerLogger, RetryWithBackoffOptions } from "./error-handlers.ts";

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
  AGENT_ERROR_CATALOG,
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

export type {
  ErrorCatalog,
  ErrorSolution,
  ErrorSolutionConfig,
  PartialErrorCatalog,
} from "./catalog/index.ts";

export {
  ERROR_SOLUTIONS,
  formatUserError,
  identifyError,
  wrapErrorHandler,
} from "./user-friendly/index.ts";

export type { ErrorSolution as UserFriendlyErrorSolution } from "./user-friendly/index.ts";

export {
  createError,
  ensureError,
  fromError,
  getErrorMessage,
  toError,
} from "./veryfront-error.ts";
export type {
  AgentContext,
  APIContext,
  BuildContext,
  ConfigContext,
  FileContext,
  NetworkContext,
  RenderContext,
  VeryfrontErrorData,
} from "./veryfront-error.ts";
