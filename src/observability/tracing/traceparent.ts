/**
 * W3C `traceparent` encoding for span contexts that must survive a process.
 *
 * A span context lives only as long as the process holding it. Work that
 * suspends and resumes later -- a workflow parked on an approval -- has to
 * write its trace identity somewhere durable and read it back into a link.
 * That wire format is `traceparent`, and this module is the only place that
 * knows it.
 *
 * @module observability/tracing/traceparent
 */

import type { SpanContext } from "./api-shim.ts";

const INVALID_TRACE_ID = "0".repeat(32);
const INVALID_SPAN_ID = "0".repeat(16);
const TRACEPARENT_PATTERN = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

/** Neither id may be all zeroes: the W3C spec reserves that for "no context". */
function isUsableSpanContext(spanContext: SpanContext): boolean {
  return spanContext.traceId !== INVALID_TRACE_ID && spanContext.spanId !== INVALID_SPAN_ID;
}

/**
 * Encode a span context as a `traceparent` header value.
 *
 * Returns undefined for the placeholder context a no-op tracer hands back, so
 * callers never persist an identity that can never be linked to.
 */
export function formatTraceparent(spanContext: SpanContext | undefined): string | undefined {
  if (!spanContext || !isUsableSpanContext(spanContext)) return undefined;
  const flags = (spanContext.traceFlags & 0xff).toString(16).padStart(2, "0");
  return `00-${spanContext.traceId}-${spanContext.spanId}-${flags}`;
}

/**
 * Decode a `traceparent` header value into a span context.
 *
 * Version `ff` is forbidden by the spec, and a future version's extra fields
 * are ignored rather than rejected, so a record written by a newer writer
 * still links.
 */
export function parseTraceparent(traceparent: string | undefined): SpanContext | undefined {
  if (!traceparent) return undefined;
  const match = TRACEPARENT_PATTERN.exec(traceparent.trim().split("-", 4).join("-"));
  if (!match) return undefined;

  const [, version, traceId, spanId, flags] = match;
  if (!version || !traceId || !spanId || !flags) return undefined;
  if (version === "ff") return undefined;

  const spanContext: SpanContext = {
    traceId,
    spanId,
    traceFlags: Number.parseInt(flags, 16),
  };
  return isUsableSpanContext(spanContext) ? spanContext : undefined;
}
