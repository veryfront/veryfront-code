import * as dntShim from "../../../../../_dnt.shims.js";
import { BaseHandler } from "../../response/base.js";
import type { HandlerContext, HandlerMetadata, HandlerResult } from "../../types.js";
export declare class ProjectsHandler extends BaseHandler {
    metadata: HandlerMetadata;
    protected shouldHandle(req: dntShim.Request, ctx: HandlerContext): boolean;
    handle(req: dntShim.Request, ctx: HandlerContext): Promise<HandlerResult>;
    private notFound;
}
//# sourceMappingURL=index.d.ts.map