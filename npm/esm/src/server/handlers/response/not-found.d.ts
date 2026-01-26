import * as dntShim from "../../../../_dnt.shims.js";
import { BaseHandler } from "./base.js";
import type { HandlerContext, HandlerMetadata, HandlerResult } from "../types.js";
export declare class NotFoundHandler extends BaseHandler {
    metadata: HandlerMetadata;
    handle(req: dntShim.Request, ctx: HandlerContext): Promise<HandlerResult>;
    private generate404Html;
}
//# sourceMappingURL=not-found.d.ts.map