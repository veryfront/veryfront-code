/**
 * Static File Handler
 * Serves static files from dist/ and public/ directories
 *
 * Security: Uses secure filesystem wrapper to prevent path traversal attacks
 */
import * as dntShim from "../../../../_dnt.shims.js";
import { BaseHandler } from "../response/base.js";
import type { HandlerContext, HandlerMetadata, HandlerResult } from "../types.js";
export declare class StaticHandler extends BaseHandler {
    private static manifestCache;
    private static manifestLoading;
    metadata: HandlerMetadata;
    handle(req: dntShim.Request, ctx: HandlerContext): Promise<HandlerResult>;
    private tryServeStatic;
    private resolveManifestAsset;
    private loadManifestIndex;
    private extractManifestAssets;
    private isAssetRequest;
}
//# sourceMappingURL=static.d.ts.map