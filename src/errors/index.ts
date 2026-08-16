/**
 * Structured error system with slug-based registry, RFC 9457 HTTP problem
 * details, error boundaries for HTTP and CLI, and user-friendly formatting.
 *
 * @module errors
 * @example Define and create a structured framework error
 * ```ts
 * import { defineError } from "veryfront/errors";
 *
 * const INVALID_WIDGET = defineError({
 *   slug: "invalid-widget",
 *   category: "GENERAL",
 *   title: "Invalid widget",
 *   status: 400,
 * });
 * throw INVALID_WIDGET.create({ detail: "The widget id is malformed." });
 * ```
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
  AUTHENTICATION_REQUIRED,
  // DEPLOY
  BRANCH_NOT_FOUND,
  // BUILD
  BUILD_FAILED,
  BUNDLE_ERROR,
  CACHE_ERROR,
  CACHE_INVARIANT_VIOLATION,
  CACHE_PATH_MISMATCH,
  CIRCUIT_BREAKER_OPEN,
  CIRCULAR_DEPENDENCY,
  // BOUNDARY
  CLIENT_BOUNDARY_VIOLATION,
  CLIENT_ONLY_IN_SERVER,
  COMPILATION_ERROR,
  COMPONENT_ERROR,
  CONFIG_INVALID,
  CONFIG_NOT_DEPLOYABLE,
  // CONFIG
  CONFIG_NOT_FOUND,
  CONFIG_PARSE_ERROR,
  CONFIG_TYPE_ERROR,
  CONFIG_VALIDATION_ERROR,
  CONFIG_VALIDATION_FAILED,
  CORS_CONFIG_INVALID,
  COST_LIMIT_EXCEEDED,
  DEPENDENCY_MISSING,
  DEPLOYMENT_ERROR,
  DEPLOYMENT_VERIFICATION_TIMEOUT,
  DEV_SERVER_ERROR,
  DURABLE_RUN_EVENT_PERSISTENCE_FAILED,
  DYNAMIC_ROUTE_ERROR,
  ENV_VAR_MISSING,
  ENVIRONMENT_NOT_FOUND,
  ENVIRONMENT_NOT_ROUTABLE,
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
  LOCKFILE_FORMAT_MISMATCH,
  LOCKFILE_READ_ERROR,
  MARKDOWN_COMPILE_ERROR,
  MDX_COMPILE_ERROR,
  MIDDLEWARE_ERROR,
  // MODULE
  MODULE_NOT_FOUND,
  NESTED_CWD_SCOPE,
  NETWORK_ERROR,
  NOT_SUPPORTED,
  ORCHESTRATION_ERROR,
  PAGE_NOT_FOUND,
  PERMISSION_DENIED,
  PLATFORM_ERROR,
  // SERVER
  PORT_IN_USE,
  PREVIEW_HOSTNAME_TOO_LONG,
  PRODUCTION_BUILD_REQUIRED,
  PROJECT_EXECUTION_UNAVAILABLE,
  PROJECT_SOURCE_EMPTY,
  PUSH_CONFLICT,
  PUSH_RECEIPT_MISSING,
  RAG_STORE_CORRUPT,
  RAG_STORE_UNAVAILABLE,
  RELEASE_BUILD_TIMEOUT,
  RELEASE_MISSING_VERSION,
  RELEASE_NOT_FOUND,
  RENDER_ERROR,
  REQUEST_ERROR,
  RESOURCE_NOT_FOUND,
  // ROUTE
  ROUTE_CONFLICT,
  ROUTE_HANDLER_INVALID,
  ROUTE_PARAMS_ERROR,
  RSC_PAYLOAD_ERROR,
  SCHEDULE_CONFIG_INVALID,
  SECURITY_VIOLATION,
  SEMAPHORE_TIMEOUT,
  SERVER_ONLY_IN_CLIENT,
  SERVER_START_ERROR,
  SERVICE_OVERLOADED,
  SOURCE_DIGEST_MISMATCH,
  SOURCE_MAP_ERROR,
  SOURCEMAP_ERROR,
  SSG_GENERATION_ERROR,
  SSR_OUTPUT_LIMIT_EXCEEDED,
  SYNC_STATE_INVALID,
  TEMPLATE_NOT_FOUND,
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
  type RetryWithBackoffOptions,
} from "./error-handlers.ts";

export {
  createErrorScope,
  safeFileRead,
  safeFileStat,
  safeReadDir,
  withErrorContext,
  withErrorContextSync,
} from "./error-context.ts";

export { sanitizeTerminalDiagnosticText } from "./safe-diagnostics.ts";

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
export type { ConfigContext, VeryfrontErrorData } from "./veryfront-error.ts";
export { fromError } from "./legacy-error-codec.ts";
