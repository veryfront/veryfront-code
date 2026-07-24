/**
 * Error Wrapping Utilities
 *
 * Provides utilities for wrapping unknown errors as VeryfrontError instances
 * with the unknown-error slug. Used at system boundaries to ensure all errors
 * have slug-based identity.
 *
 * @module errors/middleware/wrap-unknown
 */

import { isVeryfrontErrorInstance, snapshotKnownVeryfrontError, VeryfrontError } from "../types.ts";
import { UNKNOWN_ERROR } from "../error-registry.ts";
import { isErrorInstance, snapshotErrorAsError, snapshotKnownError } from "../veryfront-error.ts";
import { redactForSerialization } from "#veryfront/utils/logger/redact.ts";

function snapshotContext(
  context: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!context) return undefined;
  const snapshot = redactForSerialization(context);
  return snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
    ? snapshot as Record<string, unknown>
    : undefined;
}

function stringifyThrownValue(error: unknown): string {
  try {
    return String(error);
  } catch {
    return "Unknown error";
  }
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
  if (isVeryfrontErrorInstance(error)) {
    if (snapshotKnownVeryfrontError(error)) return error;
    return UNKNOWN_ERROR.create({
      detail: "Unknown error",
      context: snapshotContext(context),
    });
  }

  if (isErrorInstance(error)) {
    const snapshot = snapshotKnownError(error);
    return UNKNOWN_ERROR.create({
      detail: snapshot?.message ?? "Unknown error",
      cause: snapshot ? error : undefined,
      context: snapshotContext(context),
    });
  }

  return UNKNOWN_ERROR.create({
    detail: stringifyThrownValue(error),
    context: snapshotContext(context),
  });
}

/**
 * Detach a thrown value at a system boundary, then normalize the stable copy.
 *
 * This prevents stateful Error proxies from reporting different identities to
 * observability, formatting, and the final response.
 */
export function detachBoundaryError(error: unknown): VeryfrontError {
  return wrapUnknownError(snapshotErrorAsError(error));
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
  const extraContext = snapshotContext(context);

  // If already a VeryfrontError, preserve slug but update message/context
  if (isVeryfrontErrorInstance(error)) {
    const snapshot = snapshotKnownVeryfrontError(error);
    if (!snapshot) {
      return UNKNOWN_ERROR.create({
        detail: `${message}: Unknown error`,
        context: extraContext,
      });
    }
    const combinedMessage = `${message}: ${snapshot.message}`;
    const originalContext = snapshot.context && typeof snapshot.context === "object"
      ? snapshotContext(snapshot.context as Record<string, unknown>)
      : undefined;

    return new VeryfrontError(combinedMessage, {
      slug: snapshot.slug,
      category: snapshot.category,
      status: snapshot.status,
      title: snapshot.title,
      suggestion: snapshot.suggestion,
      detail: combinedMessage,
      cause: snapshot.cause,
      instance: snapshot.instance,
      context: {
        ...originalContext,
        ...extraContext,
        originalError: {
          message: snapshot.message,
          slug: snapshot.slug,
        },
      },
    });
  }

  if (isErrorInstance(error)) {
    const snapshot = snapshotKnownError(error);
    const originalMessage = snapshot?.message ?? "Unknown error";
    return UNKNOWN_ERROR.create({
      detail: `${message}: ${originalMessage}`,
      cause: snapshot ? error : undefined,
      context: {
        ...extraContext,
        originalMessage,
      },
    });
  }

  const originalMessage = stringifyThrownValue(error);
  return UNKNOWN_ERROR.create({
    detail: `${message}: ${originalMessage}`,
    context: {
      ...extraContext,
      originalMessage,
    },
  });
}
