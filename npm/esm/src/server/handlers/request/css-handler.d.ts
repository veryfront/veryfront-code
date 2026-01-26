import * as dntShim from "../../../../_dnt.shims.js";
import { BaseHandler } from "../response/base.js";
import type { HandlerContext, HandlerMetadata, HandlerResult } from "../types.js";
export declare class CSSHandler extends BaseHandler {
    metadata: HandlerMetadata;
    handle(req: dntShim.Request, ctx: HandlerContext): Promise<HandlerResult>;
}
//# sourceMappingURL=css-handler.d.ts.map