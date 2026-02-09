/**
 * Error handling middleware
 *
 * Provides unified error boundaries for HTTP and CLI boundaries.
 */

export { httpErrorBoundary, wrapHandlerWithErrorBoundary } from "./http-error-boundary.ts";
export { cliErrorBoundary, cliErrorBoundarySync, formatCLIError } from "./cli-error-boundary.ts";
export { isVeryfrontError, wrapUnknownError, wrapWithContext } from "./wrap-unknown.ts";
