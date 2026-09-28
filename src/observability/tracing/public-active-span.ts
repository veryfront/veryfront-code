import { type AttributeValue, publicTrace } from "./api-shim.ts";
import { sanitizeTelemetryAttributes } from "../telemetry-error.ts";

/** Return the application's active trace, using the platform context outside project execution. */
export function getTraceContext(): { traceId?: string; spanId?: string } {
  try {
    const context = publicTrace.getActiveSpan()?.spanContext();
    return context ? { traceId: context.traceId, spanId: context.spanId } : {};
  } catch {
    return {};
  }
}

/** Update application span attributes without changing the internal platform span. */
export function setActiveSpanAttributes(attributes: Record<string, AttributeValue>): void {
  try {
    publicTrace.getActiveSpan()?.setAttributes(sanitizeTelemetryAttributes(attributes));
  } catch { /* Telemetry must not fail application work. */ }
}
