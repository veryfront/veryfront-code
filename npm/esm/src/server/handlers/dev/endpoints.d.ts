/****
 * Development Endpoints Handler
 * Handles HMR runtime, error overlay, and other dev-specific endpoints
 */
import * as dntShim from "../../../../_dnt.shims.js";
import { BaseHandler } from "../response/base.js";
import type { HandlerContext, HandlerMetadata, HandlerResult } from "../types.js";
export declare class DevEndpointsHandler extends BaseHandler {
    metadata: HandlerMetadata;
    handle(req: dntShim.Request, ctx: HandlerContext): Promise<HandlerResult>;
    private getScriptForPath;
    private getHMRScript;
    private getHydrateScript;
    private getHMRRuntime;
    private getErrorOverlay;
    private getDevLoader;
    private getPreviewHMRScript;
}
//# sourceMappingURL=endpoints.d.ts.map