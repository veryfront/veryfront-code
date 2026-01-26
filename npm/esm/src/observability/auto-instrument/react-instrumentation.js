import { endSpan, setSpanAttributes, SpanNames, startSpan, withSpan } from "../tracing/index.js";
import { recordRenderError } from "../metrics/index.js";
export function instrumentReactRender(renderFn, componentName) {
    return withSpan(SpanNames.RENDER_COMPONENT, async (span) => {
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
        }
        catch (error) {
            handleRenderError(span, error, componentName);
            throw error;
        }
    }, {
        kind: "internal",
        attributes: { "component.name": componentName },
    });
}
export function instrumentErrorHandler(handler, captureToSpan = true) {
    return (error, request) => {
        if (captureToSpan)
            captureErrorToSpan(error, request);
        return handler(error, request);
    };
}
function handleRenderError(span, error, componentName) {
    recordRenderError({ component: componentName });
    // endSpan is handled by withActiveSpan automatically,
    // but we need to record the exception and status
    if (!span)
        return;
    span.recordException(error);
    span.setStatus({ code: 2, message: String(error) }); // 2 = ERROR
}
function recordRenderDuration(span, startTime) {
    const duration = performance.now() - startTime;
    setSpanAttributes(span, { "render.duration_ms": Math.floor(duration) });
}
function captureErrorToSpan(error, request) {
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
