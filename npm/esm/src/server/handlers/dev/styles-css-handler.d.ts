/**
 * Styles CSS Handler
 *
 * Serves Tailwind CSS compiled from user's stylesheet + all project source files.
 * Extracts candidates from ALL source files to ensure HMR includes new classes.
 */
import * as dntShim from "../../../../_dnt.shims.js";
import { BaseHandler } from "../response/base.js";
import type { HandlerContext, HandlerMetadata, HandlerResult } from "../types.js";
export declare class StylesCSSHandler extends BaseHandler {
    metadata: HandlerMetadata;
    handle(req: dntShim.Request, ctx: HandlerContext): Promise<HandlerResult>;
    private loadStylesheet;
    private extractProjectCandidates;
    /**
     * Fallback: scan local files for Tailwind candidates when no FS adapter is available.
     * Used in local development mode where projects are read directly from disk.
     */
    private scanLocalFiles;
}
//# sourceMappingURL=styles-css-handler.d.ts.map