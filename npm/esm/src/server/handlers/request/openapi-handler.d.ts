import * as dntShim from "../../../../_dnt.shims.js";
import { BaseHandler } from "../response/base.js";
import type { HandlerContext, HandlerMetadata, HandlerResult } from "../types.js";
export declare class OpenAPIHandler extends BaseHandler {
    private cachedSpec;
    private cacheKey;
    metadata: HandlerMetadata;
    protected shouldHandle(req: dntShim.Request, ctx: HandlerContext): boolean;
    handle(req: dntShim.Request, ctx: HandlerContext): Promise<HandlerResult>;
    private getOrGenerateSpec;
    private tryDiscover;
}
//# sourceMappingURL=openapi-handler.d.ts.map