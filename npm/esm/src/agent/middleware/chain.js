import { withSpan } from "../../observability/tracing/otlp-setup.js";
export class MiddlewareChain {
    middleware;
    constructor(middleware = []) {
        this.middleware = middleware;
    }
    execute(context, finalHandler) {
        return withSpan("agent.middleware.chain.execute", () => {
            let index = 0;
            const dispatch = () => {
                const middlewareIndex = index++;
                const currentMiddleware = this.middleware[middlewareIndex];
                if (!currentMiddleware) {
                    return finalHandler();
                }
                return withSpan(`agent.middleware.chain.dispatch.${index}`, () => currentMiddleware(context, dispatch), { "middleware.index": middlewareIndex });
            };
            return dispatch();
        }, { "middleware.count": this.middleware.length });
    }
    use(middleware) {
        this.middleware.push(middleware);
        return this;
    }
    prepend(middleware) {
        this.middleware.unshift(middleware);
        return this;
    }
    get length() {
        return this.middleware.length;
    }
    isEmpty() {
        return this.middleware.length === 0;
    }
}
export function createMiddlewareChain(middleware) {
    return new MiddlewareChain(middleware);
}
