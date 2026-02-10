/**
 * Error Wrapping Utilities
 *
 * Provides utilities for wrapping unknown errors as VeryfrontError instances
 * with the unknown-error slug. Used at system boundaries to ensure all errors
 * have slug-based identity.
 *
 * @module errors/middleware/wrap-unknown
 */

import { VeryfrontError } from "../types.ts";
import { UNKNOWN_ERROR } from "../error-registry.ts";
import { getErrorMessage } from "../veryfront-error.ts";

/**
 * Wrap any unknown error as a VeryfrontError with unknown-error slug
 *
 * This function is used at system boundaries (HTTP, CLI, etc.) to ensure
 * all errors have slug-based identity for consistent handling.
 *
 * @param error - Any error value (Error, VeryfrontError, string, etc.)
 * @param context - Optional context to add to the wrapped error
 * @returns VeryfrontError instance with unknown-error slug
 *
 * @example
 * ```typescript
 * try {
 *   // Some operation
 * } catch (error) {
 *   const vfError = wrapUnknownError(error);
 *   return createErrorResponse(vfError);
 * }
 * ```
 */
export function wrapUnknownError(
  error: unknown,
  context?: Record<string, unknown>,
): VeryfrontError {
  // If already a VeryfrontError, return as-is
  if (error instanceof VeryfrontError) {
    return error;
  }

  // Extract message from the error
  const message = getErrorMessage(error);

  // Preserve original Error as cause if available
  const cause = error instanceof Error ? error : undefined;

  // Create unknown-error with preserved information
  return UNKNOWN_ERROR.create({
    detail: message,
    cause,
    context: context ? { ...context } : undefined,
  });
}

/**
 * Check if an error is already a VeryfrontError
 *
 * @param error - Any error value
 * @returns True if the error is a VeryfrontError instance
 */
export function isVeryfrontError(error: unknown): error is VeryfrontError {
  return error instanceof VeryfrontError;
}

/**
 * Wrap an error with additional context
 *
 * If the error is already a VeryfrontError, preserves its slug and adds context.
 * If the error is a plain Error, wraps it as unknown-error.
 *
 * @param error - Any error value
 * @param message - Additional message to prepend
 * @param context - Additional context to add
 * @returns VeryfrontError with added context
 *
 * @example
 * ```typescript
 * try {
 *   await fetchData();
 * } catch (error) {
 *   throw wrapWithContext(error, "Failed to fetch data", { userId: 123 });
 * }
 * ```
 */
export function wrapWithContext(
  error: unknown,
  message: string,
  context?: Record<string, unknown>,
): VeryfrontError {
  const originalMessage = getErrorMessage(error);
  const combinedMessage = `${message}: ${originalMessage}`;

  // If already a VeryfrontError, preserve slug but update message/context
  if (error instanceof VeryfrontError) {
    return new VeryfrontError(combinedMessage, {
      slug: error.slug,
      category: error.category,
      status: error.status,
      title: error.title,
      suggestion: error.suggestion,
      detail: combinedMessage,
      cause: error.cause,
      instance: error.instance,
      context: {
        ...(error.context as Record<string, unknown> ?? {}),
        ...context,
        originalError: {
          message: error.message,
          slug: error.slug,
        },
      },
    });
  }

  // Wrap as unknown-error
  return UNKNOWN_ERROR.create({
    detail: combinedMessage,
    cause: error instanceof Error ? error : undefined,
    context: {
      ...context,
      originalMessage,
    },
  });
}
