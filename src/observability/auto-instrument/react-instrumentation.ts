import { type Span, SpanStatusCode } from "#veryfront/observability/tracing/api-shim.ts";
import { sanitizeUrlForSpan } from "#veryfront/utils/logger/redact.ts";
import { endSpan, setSpanAttributes, SpanNames, startSpan, withSpan } from "../tracing/index.ts";
import { recordRenderError } from "../metrics/index.ts";
import { sanitizeErrorForTelemetry } from "../telemetry-error.ts";

/** Instrument a React render operation. */
export function instrumentReactRender<T>(
  renderFn: () => PromiseLike<T> | T,
  componentName: string,
): Promise<T> {
  return withSpan(
    SpanNames.RENDER_COMPONENT,
    async (span) => {
      const startTime = performance.now();

      try {
        const resolved = await Promise.resolve(renderFn());

        recordRenderDuration(span, startTime);
        return resolved;
      } catch (error) {
        handleRenderError(span, error, componentName);
        throw error;
      }
    },
    {
      kind: "internal",
      attributes: { "component.name": componentName },
    },
  );
}

/** Handler for instrument error. */
export function instrumentErrorHandler(
  handler: (error: Error, request?: Request) => Promise<Response> | Response,
  captureToSpan = true,
): (error: Error, request?: Request) => Promise<Response> | Response {
  return (error: Error, request?: Request): Promise<Response> | Response => {
    if (captureToSpan) {
      try {
        captureErrorToSpan(error, request);
      } catch (_) {
        /* expected: telemetry failures must not prevent error handling */
      }
    }
    return handler(error, request);
  };
}

function handleRenderError(span: Span | null, error: unknown, componentName: string): void {
  recordRenderError({ component: componentName });

  // endSpan is handled by withActiveSpan automatically,
  // but we need to record the exception and status
  if (!span) return;

  const telemetryError = sanitizeErrorForTelemetry(error);
  try {
    span.recordException(telemetryError);
  } catch (_) {
    /* expected: telemetry failures must not replace render failures */
  }
  try {
    span.setStatus({ code: SpanStatusCode.ERROR, message: telemetryError.message });
  } catch (_) {
    /* expected: telemetry failures must not replace render failures */
  }
}

function recordRenderDuration(span: Span | null, startTime: number): void {
  const duration = performance.now() - startTime;
  setSpanAttributes(span, { "render.duration_ms": Math.floor(duration) });
}

function captureErrorToSpan(error: Error, request?: Request): void {
  const telemetryError = sanitizeErrorForTelemetry(error);
  const span = startSpan("error.handler", {
    kind: "internal",
    attributes: {
      "error.type": telemetryError.name,
      "error.message": telemetryError.message,
      "error.stack": telemetryError.stack ?? "",
    },
  });

  if (request) {
    const url = new URL(request.url);
    setSpanAttributes(span, {
      "http.method": request.method,
      "http.url": sanitizeUrlForSpan(request.url),
      "http.path": url.pathname,
    });
  }

  endSpan(span, telemetryError);
}
