/**
 * Error tracing integration for OpenTelemetry
 *
 * Attaches error metadata to spans for distributed tracing and error correlation.
 */

import type { Span } from "#veryfront/observability/tracing/api-shim.ts";
import { SpanStatusCode } from "#veryfront/observability/tracing/api-shim.ts";
import type { VeryfrontError } from "./types.ts";
import { sanitizeDiagnosticText, snapshotErrorForBoundary } from "./safe-diagnostics.ts";

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
 * Span status: Set to ERROR with the stable error slug as message
 * Span event: "error" event with non-sensitive identity metadata
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
export function attachErrorToSpan(error: VeryfrontError, span: Span): void {
  const snapshot = snapshotErrorForBoundary(error);
  const slug = sanitizeDiagnosticText(snapshot.slug);

  // Set span status to ERROR
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: slug,
  });

  // Set error attributes for filtering and grouping
  span.setAttributes({
    "error.slug": slug,
    "error.category": snapshot.category,
    "error.status": snapshot.status,
  });

  // Diagnostic text may contain credentials or internal payloads. Keep span
  // events limited to the same stable, non-sensitive identity fields.
  span.addEvent("error", {
    "error.slug": slug,
    "error.category": snapshot.category,
    "error.status": snapshot.status,
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
  trace: { getActiveSpan(): Span | undefined },
): void {
  const span = trace.getActiveSpan();
  if (span) {
    attachErrorToSpan(error, span);
  }
}
