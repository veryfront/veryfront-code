export { ErrorCode, VeryfrontError } from "./types.js";

export {
  AgentError,
  AgentIntentError,
  AgentNotFoundError,
  AgentTimeoutError,
  OrchestrationError,
} from "./agent-errors.js";

export { BuildError, CompilationError } from "./build-errors.js";

export { RenderError, RuntimeError } from "./runtime-errors.js";

export {
  ConfigError,
  FileSystemError,
  NetworkError,
  NotSupportedError,
  PermissionError,
} from "./system-errors.js";

export {
  handleError,
  handleErrorWithFallback,
  handleErrorWithFallbackSync,
  logAndThrow,
  retryWithBackoff,
  wrapError,
} from "./error-handlers.js";

export {
  createErrorScope,
  safeFileRead,
  safeFileStat,
  safeReadDir,
  withErrorContext,
  withErrorContextSync,
} from "./error-context.js";

export type { ErrorContext, ErrorHandlingOptions, LogLevel } from "./error-context.js";

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
} from "./catalog/index.js";

export type { ErrorCatalog, ErrorSolution, PartialErrorCatalog } from "./catalog/index.js";

export {
  ERROR_SOLUTIONS,
  formatUserError,
  identifyError,
  wrapErrorHandler,
} from "./user-friendly/index.js";

export type { ErrorSolution as UserFriendlyErrorSolution } from "./user-friendly/index.js";

export type { ErrorCodeType } from "./error-codes.js";

export { createError, ensureError, getErrorMessage, toError } from "./veryfront-error.js";
export type { VeryfrontErrorData } from "./veryfront-error.js";
