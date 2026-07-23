/**
 * Error handling middleware
 *
 * Provides unified error boundaries for HTTP and CLI boundaries.
 */

export {
  errorToRFC9457Response,
  httpErrorBoundary,
  wrapHandlerWithErrorBoundary,
} from "./http-error-boundary.ts";
export type {
  ErrorBoundaryContext,
  ErrorBoundaryHandler,
  ErrorBoundaryResult,
} from "./http-error-boundary.ts";
export { cliErrorBoundary, cliErrorBoundarySync, formatCLIError } from "./cli-error-boundary.ts";
export type { CLIErrorBoundaryOptions } from "./cli-error-boundary.ts";
export { wrapUnknownError, wrapWithContext } from "./wrap-unknown.ts";
