/**
 * Error tracing integration for OpenTelemetry
 *
 * Attaches error metadata to spans for distributed tracing and error correlation.
 */

import type { Span } from "@opentelemetry/api";
import { SpanStatusCode } from "@opentelemetry/api";
import type { VeryfrontError } from "./types.ts";

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
 * Span event: "error" event with slug and detail
 *
 * @param error - The VeryfrontError to attach
 * @param span - The OpenTelemetry span to attach to
 *
 * @example
 * ```typescript
 * import { trace } from "@opentelemetry/api";
 *
 * const span = trace.getActiveSpan();
 * if (span) {
 *   attachErrorToSpan(error, span);
 * }
 * ```
 */
export function attachErrorToSpan(error: VeryfrontError, span: Span): void {
  // Set span status to ERROR
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: error.title,
  });

  // Set error attributes for filtering and grouping
  span.setAttributes({
    "error.slug": error.slug,
    "error.category": error.category,
    "error.status": error.status,
  });

  // Add error event with details
  span.addEvent("error", {
    "error.slug": error.slug,
    "error.detail": error.detail ?? "",
    "error.suggestion": error.suggestion ?? "",
  });
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
 * import { trace } from "@opentelemetry/api";
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
  trace: { getActiveSpan(): Span | undefined },
): void {
  const span = trace.getActiveSpan();
  if (span) {
    attachErrorToSpan(error, span);
  }
}
