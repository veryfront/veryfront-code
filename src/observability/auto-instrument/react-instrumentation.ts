import type { Span } from "npm:@opentelemetry/api@1";
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
          return await handleAsyncRender(result, span, startTime, componentName);
        }

        return handleSyncRender(result, span, startTime);
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
    if (captureToSpan) {
      captureErrorToSpan(error, request);
    }

    return handler(error, request);
  };
}

async function handleAsyncRender<T>(
  result: Promise<T>,
  span: Span | null,
  startTime: number,
  _componentName: string,
): Promise<T> {
  try {
    const resolved = await result;
    recordRenderDuration(span, startTime);
    return resolved;
  } catch (error) {
    // Error handling already done in instrumentReactRender wrapper
    // but we need to re-throw for the promise chain
    throw error;
  }
}

function handleSyncRender<T>(result: T, span: Span | null, startTime: number): T {
  recordRenderDuration(span, startTime);
  return result;
}

function handleRenderError(span: Span | null, error: unknown, componentName: string): void {
  recordRenderError({ component: componentName });
  // endSpan is handled by withActiveSpan automatically,
  // but we need to record the exception and status
  if (span) {
    span.recordException(error as Error);
    span.setStatus({ code: 2, message: String(error) }); // 2 = ERROR
  }
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
      "error.stack": error.stack || "",
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
