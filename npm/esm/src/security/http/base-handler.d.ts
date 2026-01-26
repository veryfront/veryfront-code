import * as dntShim from "../../../_dnt.shims.js";
import type { Handler, HandlerContext, HandlerMetadata, HandlerResult } from "../../types/index.js";
import { ResponseBuilder } from "./response/index.js";
export interface HandlerHelpers {
    createResponseBuilder: (ctx: HandlerContext, nonce?: string) => ResponseBuilder;
    respond: (response: dntShim.Response, metadata?: Record<string, unknown>) => HandlerResult;
    logDebug: (message: string, extra?: Record<string, unknown>, ctx?: HandlerContext) => void;
    getErrorMessage: (error: unknown) => string;
    continue: () => HandlerResult;
}
export declare abstract class BaseHandler implements Handler {
    abstract metadata: HandlerMetadata;
    protected readonly helpers: HandlerHelpers;
    constructor();
    abstract handle(req: dntShim.Request, ctx: HandlerContext): Promise<HandlerResult>;
    protected shouldHandle(req: dntShim.Request, ctx: HandlerContext): boolean;
    private matchesPattern;
    protected createResponseBuilder(ctx: HandlerContext, nonce?: string, _options?: Record<string, unknown>): ResponseBuilder;
    protected logDebug(message: string, extra?: Record<string, unknown>, ctx?: HandlerContext): void;
    protected logInfo(message: string, extra?: Record<string, unknown>, _ctx?: HandlerContext): void;
    protected getErrorMessage(error: unknown): string;
    protected continue(): HandlerResult;
    protected respond(response: dntShim.Response, metadata?: Record<string, unknown>): HandlerResult;
    protected withProxyContext<T>(ctx: HandlerContext, fn: () => Promise<T>, options?: {
        requireToken?: boolean;
    }): Promise<T>;
}
//# sourceMappingURL=base-handler.d.ts.map