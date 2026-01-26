import * as dntShim from "../../../_dnt.shims.js";
import type { Context, ExecutionContext } from "./types.js";
export declare class MiddlewareContext implements Context {
    req: dntShim.Request;
    request: dntShim.Request;
    env: Record<string, unknown>;
    executionCtx?: ExecutionContext;
    var: Record<string, unknown>;
    private store;
    constructor(req: dntShim.Request, env?: Record<string, unknown>, executionCtx?: ExecutionContext);
    json(object: unknown, init?: dntShim.ResponseInit): dntShim.Response;
    text(text: string, init?: dntShim.ResponseInit): dntShim.Response;
    html(html: string, init?: dntShim.ResponseInit): dntShim.Response;
    redirect(location: string, status?: number): dntShim.Response;
    set(key: string, value: unknown): void;
    get(key: string): unknown;
}
//# sourceMappingURL=context.d.ts.map