import { composeMiddleware } from "./composer.js";
import { executeMiddlewarePipeline } from "./executor.js";
import { serverLogger } from "../../../utils/logger/logger.js";
export class MiddlewarePipeline {
    middlewares = [];
    teardownCallbacks = [];
    registry = [];
    constructor(_options = {}) { }
    use(middleware) {
        this.middlewares.push(middleware);
        return this;
    }
    useFor(pattern, ...handlers) {
        this.registry.push({ pattern, use: handlers });
        return this;
    }
    onTeardown(cb) {
        this.teardownCallbacks.push(cb);
        return this;
    }
    compose() {
        return composeMiddleware(this.middlewares, this.registry);
    }
    execute(req, env, executionCtx, adapter) {
        const handler = this.compose();
        return executeMiddlewarePipeline(req, handler, env, executionCtx, adapter);
    }
    async teardown() {
        const callbacks = this.teardownCallbacks;
        this.teardownCallbacks = [];
        for (const cb of callbacks) {
            try {
                await cb();
            }
            catch (e) {
                serverLogger.warn("middleware teardown failed", e);
            }
        }
    }
    getMiddleware() {
        return this.middlewares.map((mw, index) => ({
            name: mw.name ?? "anonymous",
            order: index,
        }));
    }
}
