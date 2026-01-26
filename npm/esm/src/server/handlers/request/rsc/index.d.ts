/**
 * React Server Components Handler
 * Handles RSC endpoints and streaming
 */
import * as dntShim from "../../../../../_dnt.shims.js";
import { BaseHandler } from "../../response/base.js";
import type { HandlerContext, HandlerMetadata, HandlerResult } from "../../types.js";
export declare class RSCHandler extends BaseHandler {
    metadata: HandlerMetadata;
    handle(req: dntShim.Request, ctx: HandlerContext): Promise<HandlerResult>;
}
//# sourceMappingURL=index.d.ts.map