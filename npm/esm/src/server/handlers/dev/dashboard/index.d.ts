import * as dntShim from "../../../../../_dnt.shims.js";
import { BaseHandler } from "../../response/base.js";
import type { HandlerContext, HandlerMetadata, HandlerResult } from "../../types.js";
export declare class DevDashboardHandler extends BaseHandler {
    metadata: HandlerMetadata;
    protected shouldHandle(req: dntShim.Request, _ctx: HandlerContext): boolean;
    handle(req: dntShim.Request, ctx: HandlerContext): Promise<HandlerResult>;
    private respondNotFound;
}
//# sourceMappingURL=index.d.ts.map