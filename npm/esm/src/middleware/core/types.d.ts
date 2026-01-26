import * as dntShim from "../../../_dnt.shims.js";
export interface ExecutionContext {
    waitUntil(promise: Promise<unknown>): void;
    passThroughOnException(): void;
}
export interface Context {
    req: dntShim.Request;
    request: dntShim.Request;
    env: Record<string, unknown>;
    executionCtx?: ExecutionContext;
    var: Record<string, unknown>;
    json(object: unknown, init?: dntShim.ResponseInit): dntShim.Response;
    text(text: string, init?: dntShim.ResponseInit): dntShim.Response;
    html(html: string, init?: dntShim.ResponseInit): dntShim.Response;
    redirect(location: string, status?: number): dntShim.Response;
    set(key: string, value: unknown): void;
    get(key: string): unknown;
}
export type Next = () => Promise<dntShim.Response | undefined> | dntShim.Response;
export type MiddlewareHandler = (c: Context, next: Next) => Promise<dntShim.Response | undefined> | dntShim.Response | undefined;
export type MiddlewareFactory<T = unknown> = (options?: T) => MiddlewareHandler;
//# sourceMappingURL=types.d.ts.map