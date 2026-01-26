import { serverLogger as logger } from "../../utils/index.js";
export class SpanOperations {
    api;
    tracer;
    constructor(api, tracer) {
        this.api = api;
        this.tracer = tracer;
    }
    startSpan(name, options = {}) {
        try {
            const span = this.tracer.startSpan(name, {
                kind: this.mapSpanKind(options.kind),
                attributes: options.attributes ?? {},
            }, options.parent);
            return span;
        }
        catch (error) {
            logger.debug("[tracing] Failed to start span", { name, error });
            return null;
        }
    }
    endSpan(span, error) {
        if (!span)
            return;
        try {
            if (error) {
                span.recordException(error);
                span.setStatus({
                    code: this.api.SpanStatusCode.ERROR,
                    message: error.message,
                });
            }
            else {
                span.setStatus({ code: this.api.SpanStatusCode.OK });
            }
            span.end();
        }
        catch (error) {
            logger.debug("[tracing] Failed to end span", error);
        }
    }
    setAttributes(span, attributes) {
        if (!span)
            return;
        try {
            span.setAttributes(attributes);
        }
        catch (error) {
            logger.debug("[tracing] Failed to set span attributes", error);
        }
    }
    addEvent(span, name, attributes) {
        if (!span)
            return;
        try {
            span.addEvent(name, attributes);
        }
        catch (error) {
            logger.debug("[tracing] Failed to add span event", error);
        }
    }
    createChildSpan(parentSpan, name, options = {}) {
        if (!parentSpan)
            return this.startSpan(name, options);
        try {
            const parentContext = this.api.trace.setSpan(this.api.context.active(), parentSpan);
            return this.startSpan(name, { ...options, parent: parentContext });
        }
        catch (error) {
            logger.debug("[tracing] Failed to create child span", error);
            return null;
        }
    }
    mapSpanKind(kind) {
        if (!kind)
            return this.api.SpanKind.INTERNAL;
        const kindMap = {
            internal: this.api.SpanKind.INTERNAL,
            server: this.api.SpanKind.SERVER,
            client: this.api.SpanKind.CLIENT,
            producer: this.api.SpanKind.PRODUCER,
            consumer: this.api.SpanKind.CONSUMER,
        };
        return kindMap[kind.toLowerCase()] ?? this.api.SpanKind.INTERNAL;
    }
}
