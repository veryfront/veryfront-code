/**
 * Tracing Module
 *
 * Handles OpenTelemetry tracing setup for incoming requests.
 * Extracts trace context from headers and manages server spans.
 *
 * @module server/runtime-handler/tracing
 */

import {
  endServerSpan,
  extractContext,
  setSpanAttributes,
  startServerSpan,
  withContext,
  withSpan,
} from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability";
import { extractSafeHttpScheme } from "#veryfront/observability/telemetry-safety.ts";

interface SpanInfo {
  /** The server span (unknown type from OTLP setup) */
  span: unknown;
  /** The span context (unknown type from OTLP setup) */
  context: unknown;
}

/**
 * Start tracing for an incoming request.
 * Extracts parent context from headers and creates a server span.
 */
export function startRequestTracing(req: Request, pathname: string): SpanInfo {
  const parentContext = extractContext(req.headers);
  const spanInfo = startServerSpan(req.method, pathname, parentContext);

  return {
    span: spanInfo?.span,
    context: spanInfo?.context,
  };
}

/**
 * Set initial HTTP attributes on the span.
 */
export function setRequestAttributes(span: unknown, _req: Request, url: URL): void {
  if (!span) return;

  const scheme = extractSafeHttpScheme(url.href);
  if (scheme) setSpanAttributes(span, { "http.scheme": scheme });
}

/** Compatibility hook. Generic tracing intentionally omits project identity. */
export function setProjectAttributes(
  _span: unknown,
  _projectSlug: string | undefined,
  _environment: string | undefined,
): void {
  // Generic request tracing cannot safely distinguish stable labels from
  // customer identifiers, so project context is intentionally omitted.
}

/**
 * End the server span with status and optional error.
 */
export function endRequestTracing(span: unknown, status: number, error?: unknown): void {
  endServerSpan(span, status, error);
}

/**
 * Execute a handler with the span's context.
 */
export function executeWithTracingContext<T>(
  spanInfo: SpanInfo,
  handler: () => Promise<T>,
): Promise<T> {
  if (spanInfo.context) {
    return withContext(spanInfo.context, handler);
  }
  return handler();
}

/**
 * Wrap an operation in a named span.
 */
export { SpanNames, withSpan };
