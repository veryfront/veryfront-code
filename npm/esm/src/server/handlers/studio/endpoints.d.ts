/**
 * Studio Endpoints Handler
 * Handles studio bridge script and other studio-specific endpoints
 */
import * as dntShim from "../../../../_dnt.shims.js";
import { BaseHandler } from "../../../security/index.js";
import type { HandlerContext, HandlerMetadata, HandlerResult } from "../types.js";
export declare class StudioEndpointsHandler extends BaseHandler {
    metadata: HandlerMetadata;
    handle(req: dntShim.Request, ctx: HandlerContext): Promise<HandlerResult>;
}
//# sourceMappingURL=endpoints.d.ts.map