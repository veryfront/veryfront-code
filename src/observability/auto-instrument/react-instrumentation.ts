import type { Span } from "@opentelemetry/api";
import { endSpan, setSpanAttributes, SpanNames, startSpan, withSpan } from "../tracing/index.ts";
import { recordRenderError } from "../metrics/index.ts";

export function instrumentReactRender<T>(
  renderFn: () => Promise<T> | T,
  componentName: string,
): Promise<T> {
  return withSpan(
    SpanNames.RENDER_COMPONENT,
    async (span) => {
      const startTime = performance.now();

      try {
        const result = renderFn();

        if (result instanceof Promise) {
          const resolved = await result;
          recordRenderDuration(span, startTime);
          return resolved;
        }

        recordRenderDuration(span, startTime);
        return result;
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

export function instrumentErrorHandler(
  handler: (error: Error, request?: Request) => Promise<Response> | Response,
  captureToSpan = true,
): (error: Error, request?: Request) => Promise<Response> | Response {
  return (error: Error, request?: Request): Promise<Response> | Response => {
    if (captureToSpan) captureErrorToSpan(error, request);
    return handler(error, request);
  };
}

function handleRenderError(span: Span | null, error: unknown, componentName: string): void {
  recordRenderError({ component: componentName });
  // endSpan is handled by withActiveSpan automatically,
  // but we need to record the exception and status
  if (!span) return;

  span.recordException(error as Error);
  span.setStatus({ code: 2, message: String(error) }); // 2 = ERROR
}

function recordRenderDuration(span: Span | null, startTime: number): void {
  const duration = performance.now() - startTime;
  setSpanAttributes(span, { "render.duration_ms": Math.floor(duration) });
}

function captureErrorToSpan(error: Error, request?: Request): void {
  const span = startSpan("error.handler", {
    kind: "internal",
    attributes: {
      "error.type": error.constructor.name,
      "error.message": error.message,
      "error.stack": error.stack ?? "",
    },
  });

  if (request) {
    const url = new URL(request.url);
    setSpanAttributes(span, {
      "http.method": request.method,
      "http.url": request.url,
      "http.path": url.pathname,
    });
  }

  endSpan(span, error);
}
