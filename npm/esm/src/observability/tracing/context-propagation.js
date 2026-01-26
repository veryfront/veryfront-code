import { serverLogger as logger } from "../../utils/index.js";
export class ContextPropagation {
    api;
    propagator;
    constructor(api, propagator) {
        this.api = api;
        this.propagator = propagator;
    }
    extractContext(headers) {
        try {
            const carrier = Object.fromEntries(headers);
            return this.api.propagation.extract(this.api.context.active(), carrier);
        }
        catch (error) {
            logger.debug("[tracing] Failed to extract context from headers", error);
            return undefined;
        }
    }
    injectContext(context, headers) {
        try {
            const carrier = {};
            this.api.propagation.inject(context, carrier);
            for (const [key, value] of Object.entries(carrier)) {
                headers.set(key, value);
            }
        }
        catch (error) {
            logger.debug("[tracing] Failed to inject context into headers", error);
        }
    }
    getActiveContext() {
        try {
            return this.api.context.active();
        }
        catch (error) {
            logger.debug("[tracing] Failed to get active context", error);
            return undefined;
        }
    }
    withActiveSpan(span, fn) {
        if (!span)
            return fn();
        return this.api.context.with(this.api.trace.setSpan(this.api.context.active(), span), fn);
    }
    withSpan(name, fn, startSpan, endSpan) {
        const span = startSpan(name);
        try {
            const result = fn(span);
            endSpan(span);
            return result;
        }
        catch (error) {
            endSpan(span, error);
            throw error;
        }
    }
    async withSpanAsync(name, fn, startSpan, endSpan) {
        const span = startSpan(name);
        try {
            const result = await fn(span);
            endSpan(span);
            return result;
        }
        catch (error) {
            endSpan(span, error);
            throw error;
        }
    }
}
