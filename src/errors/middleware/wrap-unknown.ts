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
import { sanitizeErrorContext, sanitizeErrorText } from "../sanitization.ts";
import { snapshotVeryfrontError } from "../error-snapshot.ts";

function diagnosticMessage(error: unknown): string {
  return sanitizeErrorText(getErrorMessage(error), 16_000);
}

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
  const message = diagnosticMessage(error);

  // Preserve original Error as cause if available
  const cause = error instanceof Error ? error : undefined;

  // Create unknown-error with preserved information
  return UNKNOWN_ERROR.create({
    detail: message,
    cause,
    context: sanitizeErrorContext(context),
  });
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
  if (
    typeof message !== "string" || message.trim().length === 0 || message.length > 4_096
  ) {
    throw new TypeError("message must be a non-empty string of at most 4096 characters");
  }
  const originalMessage = diagnosticMessage(error);
  const combinedMessage = sanitizeErrorText(
    `${sanitizeErrorText(message, 4_096)}: ${originalMessage}`,
    16_000,
  );

  // If already a VeryfrontError, preserve slug but update message/context
  if (error instanceof VeryfrontError) {
    const snapshot = snapshotVeryfrontError(error);
    return new VeryfrontError(combinedMessage, {
      slug: snapshot.slug,
      category: snapshot.category,
      status: snapshot.status,
      title: snapshot.title,
      suggestion: snapshot.suggestion,
      detail: combinedMessage,
      cause: snapshot.cause,
      instance: snapshot.instance,
      context: sanitizeErrorContext({
        ...(snapshot.context ?? {}),
        ...(sanitizeErrorContext(context) ?? {}),
        originalError: {
          message: sanitizeErrorText(getErrorMessage(error)),
          slug: snapshot.slug,
        },
      }),
    });
  }

  // Wrap as unknown-error
  return UNKNOWN_ERROR.create({
    detail: combinedMessage,
    cause: error instanceof Error ? error : undefined,
    context: sanitizeErrorContext({
      ...(sanitizeErrorContext(context) ?? {}),
      originalMessage,
    }),
  });
}
