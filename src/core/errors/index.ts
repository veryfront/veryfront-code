export { ErrorCode, VeryfrontError } from "./types.ts";

export {
  AgentError,
  AgentIntentError,
  AgentNotFoundError,
  AgentTimeoutError,
  OrchestrationError,
} from "./agent-errors.ts";

export { BuildError, CompilationError } from "./build-errors.ts";

export { RenderError, RuntimeError } from "./runtime-errors.ts";

export {
  ConfigError,
  FileSystemError,
  NetworkError,
  NotSupportedError,
  PermissionError,
} from "./system-errors.ts";

export {
  handleError,
  handleErrorWithFallback,
  handleErrorWithFallbackSync,
  logAndThrow,
  retryWithBackoff,
  wrapError,
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

export type { ErrorCodeType } from "./error-codes.ts";
