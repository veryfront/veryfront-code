/**
 * Error tracing integration for OpenTelemetry
 *
 * Attaches error metadata to spans for distributed tracing and error correlation.
 */

import { SpanStatusCode } from "#veryfront/observability/tracing/api-shim.ts";
import type { VeryfrontError } from "./types.ts";
import { snapshotVeryfrontError } from "./error-snapshot.ts";

/** Minimal tracing span contract used by error instrumentation. */
export interface ErrorTraceSpan {
  /** Set the span status. */
  setStatus(status: { code: number; message?: string }): unknown;
  /** Set stable error attributes. */
  setAttributes(attributes: Record<string, string | number | boolean>): unknown;
  /** Add a stable error event. */
  addEvent(
    name: string,
    attributes?: Record<string, string | number | boolean>,
  ): unknown;
}

/** Minimal trace API needed to resolve the active span. */
export interface ErrorTraceApi {
  /** Return the active span when one exists. */
  getActiveSpan(): ErrorTraceSpan | undefined;
}

/**
 * Attach error metadata to an OpenTelemetry span
 *
 * Sets span attributes, status, and events based on VeryfrontError fields.
 * This enables error correlation in distributed tracing systems.
 *
 * Span attributes set:
 * - error.slug: Unique error identifier
 * - error.category: Error category (CONFIG, BUILD, RUNTIME, etc.)
 * - error.status: HTTP status code
 *
 * Span status: Set to ERROR with error title as message
 * Span event: "error" event with the stable slug only
 *
 * @param error - The VeryfrontError to attach
 * @param span - The OpenTelemetry span to attach to
 *
 * @example
 * ```typescript
 * import { trace } from "#veryfront/observability/tracing/api-shim.ts";
 *
 * const span = trace.getActiveSpan();
 * if (span) {
 *   attachErrorToSpan(error, span);
 * }
 * ```
 */
export function attachErrorToSpan(error: VeryfrontError, span: ErrorTraceSpan): void {
  const snapshot = snapshotVeryfrontError(error);
  try {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: snapshot.title,
    });
  } catch {
    // Instrumentation must never replace the application failure.
  }

  try {
    span.setAttributes({
      "error.slug": snapshot.slug,
      "error.category": snapshot.category,
      "error.status": snapshot.status,
    });
  } catch {
    // Instrumentation must never replace the application failure.
  }

  try {
    span.addEvent("error", { "error.slug": snapshot.slug });
  } catch {
    // Instrumentation must never replace the application failure.
  }
}

/**
 * Attach error to the currently active span (if any)
 *
 * This is a convenience wrapper that gets the active span from the trace context.
 * Safe to call even if no span is active (no-op).
 *
 * @param error - The VeryfrontError to attach
 * @param trace - OpenTelemetry trace API (passed to avoid circular deps)
 *
 * @example
 * ```typescript
 * import { trace } from "#veryfront/observability/tracing/api-shim.ts";
 *
 * try {
 *   // ... operation that may throw
 * } catch (error) {
 *   const vfError = wrapUnknownError(error);
 *   attachErrorToActiveSpan(vfError, trace);
 *   throw vfError;
 * }
 * ```
 */
export function attachErrorToActiveSpan(
  error: VeryfrontError,
  trace: ErrorTraceApi,
): void {
  try {
    const span = trace.getActiveSpan();
    if (span) {
      attachErrorToSpan(error, span);
    }
  } catch {
    // Instrumentation must never replace the application failure.
  }
}
