import { type AttributeValue, publicTrace } from "./api-shim.ts";
import { sanitizeTelemetryAttributes } from "../telemetry-error.ts";

/** Return the active trace context, if available. */
export function getTraceContext(): { traceId?: string; spanId?: string } {
  try {
    const context = publicTrace.getActiveSpan()?.spanContext();
    return context ? { traceId: context.traceId, spanId: context.spanId } : {};
  } catch {
    return {};
  }
}

/** Add sanitized attributes to the active span, if available. */
export function setActiveSpanAttributes(attributes: Record<string, AttributeValue>): void {
  try {
    publicTrace.getActiveSpan()?.setAttributes(sanitizeTelemetryAttributes(attributes));
  } catch { /* Telemetry must not fail application work. */ }
}
