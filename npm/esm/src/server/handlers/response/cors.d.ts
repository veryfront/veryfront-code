import * as dntShim from "../../../../_dnt.shims.js";
import { BaseHandler } from "./base.js";
import type { HandlerContext, HandlerMetadata, HandlerResult } from "../types.js";
export declare class CorsHandler extends BaseHandler {
    metadata: HandlerMetadata;
    handle(req: dntShim.Request, ctx: HandlerContext): Promise<HandlerResult>;
    private static readonly DEFAULT_METHODS;
    private static readonly HTTP_METHODS;
    private static readonly ROUTE_FILE_NAMES;
    private resolveAllowedMethods;
    private resolveAppRouteFile;
}
//# sourceMappingURL=cors.d.ts.map