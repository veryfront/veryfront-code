import { serverLogger } from "../../utils/index.js";
import { withSpan } from "../../observability/tracing/otlp-setup.js";
export class RouteRegistry {
    handlers = [];
    config;
    constructor(config = {}) {
        this.config = {
            debug: false,
            enableMetrics: true,
            ...config,
        };
    }
    register(handler) {
        this.handlers.push(handler);
        this.handlers.sort((a, b) => a.metadata.priority - b.metadata.priority);
        if (this.config.debug) {
            serverLogger.debug(`[RouteRegistry] Registered handler: ${handler.metadata.name} (priority: ${handler.metadata.priority})`);
        }
        return this;
    }
    registerAll(handlers) {
        for (const handler of handlers) {
            this.register(handler);
        }
        return this;
    }
    execute(req, ctx) {
        const url = new URL(req.url);
        return withSpan("routing.registry.execute", async () => {
            const startTime = Date.now();
            if (this.config.debug) {
                serverLogger.debug(`[RouteRegistry] Processing ${req.method} ${url.pathname}`);
            }
            for (const handler of this.handlers) {
                try {
                    if (handler.metadata.enabled && !handler.metadata.enabled(ctx)) {
                        if (this.config.debug) {
                            serverLogger.debug(`[RouteRegistry] Skipping disabled handler: ${handler.metadata.name}`);
                        }
                        continue;
                    }
                    const handlerStart = Date.now();
                    // Note: Individual handler spans removed to reduce trace noise.
                    // Most handlers are very fast (< 1ms) and just check if they should handle.
                    // The outer routing.registry.execute span captures total routing time.
                    const result = await handler.handle(req, ctx);
                    const handlerTime = Date.now() - handlerStart;
                    if (this.config.debug && this.config.enableMetrics) {
                        serverLogger.debug(`[RouteRegistry] Handler ${handler.metadata.name} took ${handlerTime}ms`);
                    }
                    if (result.response) {
                        const totalTime = Date.now() - startTime;
                        if (this.config.debug) {
                            serverLogger.debug(`[RouteRegistry] Response from ${handler.metadata.name} (total: ${totalTime}ms)`);
                        }
                        return result.response;
                    }
                    if (!result.continue) {
                        if (this.config.debug) {
                            serverLogger.debug(`[RouteRegistry] Chain stopped by ${handler.metadata.name} without response`);
                        }
                        break;
                    }
                }
                catch (error) {
                    // Always log handler errors - they should never be silently swallowed
                    serverLogger.error(`[RouteRegistry] Handler ${handler.metadata.name} threw an error`, {
                        handler: handler.metadata.name,
                        path: url.pathname,
                        method: req.method,
                        error: error instanceof Error ? error.message : String(error),
                        stack: error instanceof Error ? error.stack : undefined,
                    });
                    // Continue to next handler - a single handler failure shouldn't break the chain
                }
            }
            const totalTime = Date.now() - startTime;
            if (this.config.debug) {
                serverLogger.debug(`[RouteRegistry] No handler matched (total: ${totalTime}ms)`);
            }
            return null;
        }, { "http.method": req.method, "http.path": url.pathname });
    }
    getHandlers() {
        return this.handlers;
    }
    clear() {
        this.handlers = [];
        return this;
    }
    remove(name) {
        this.handlers = this.handlers.filter((h) => h.metadata.name !== name);
        return this;
    }
    has(name) {
        return this.handlers.some((h) => h.metadata.name === name);
    }
    getStats() {
        const handlersByPriority = {};
        const handlerNames = this.handlers.map((h) => h.metadata.name);
        for (const handler of this.handlers) {
            const priority = String(handler.metadata.priority);
            handlersByPriority[priority] = (handlersByPriority[priority] ?? 0) + 1;
        }
        return {
            totalHandlers: this.handlers.length,
            handlersByPriority,
            handlerNames,
        };
    }
}
