/**
 * Snippet Handler
 *
 * Handles preview requests for component snippets (@/ prefixed paths).
 * These are MDX files that get compiled and rendered as standalone component previews.
 */
import * as dntShim from "../../../../_dnt.shims.js";
import { BaseHandler } from "../response/base.js";
import type { HandlerContext, HandlerMetadata, HandlerResult } from "../types.js";
export declare class SnippetHandler extends BaseHandler {
    metadata: HandlerMetadata;
    handle(req: dntShim.Request, ctx: HandlerContext): Promise<HandlerResult>;
    private resolveFilePath;
    private getModuleServerUrl;
    private respondNotFound;
}
//# sourceMappingURL=snippet-handler.d.ts.map