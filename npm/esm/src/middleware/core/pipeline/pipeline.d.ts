import * as dntShim from "../../../../_dnt.shims.js";
import type { ExecutionContext, MiddlewareHandler } from "../types.js";
import type { MiddlewarePipelineOptions } from "./types.js";
import type { RuntimeAdapter } from "../../../platform/adapters/base.js";
export declare class MiddlewarePipeline {
    private middlewares;
    private teardownCallbacks;
    private registry;
    constructor(_options?: MiddlewarePipelineOptions);
    use(middleware: MiddlewareHandler): this;
    useFor(pattern: RegExp, ...handlers: MiddlewareHandler[]): this;
    onTeardown(cb: () => void | Promise<void>): this;
    compose(): MiddlewareHandler;
    execute(req: dntShim.Request, env?: Record<string, unknown>, executionCtx?: ExecutionContext, adapter?: RuntimeAdapter): Promise<dntShim.Response>;
    teardown(): Promise<void>;
    getMiddleware(): Array<{
        name?: string;
        order?: number;
    }>;
}
//# sourceMappingURL=pipeline.d.ts.map