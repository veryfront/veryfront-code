/**
 * Markdown Preview Handler
 *
 * Serves standalone markdown files (*.md) with GitHub-style preview rendering.
 * Only active in preview/local dev mode. Files in pages/ or app/ are excluded.
 *
 * @module server/handlers/preview/markdown-preview-handler
 */
import * as dntShim from "../../../../_dnt.shims.js";
import { BaseHandler } from "../response/base.js";
import type { HandlerContext, HandlerMetadata, HandlerResult } from "../types.js";
export declare class MarkdownPreviewHandler extends BaseHandler {
    metadata: HandlerMetadata;
    handle(req: dntShim.Request, ctx: HandlerContext): Promise<HandlerResult>;
    private renderMarkdown;
}
//# sourceMappingURL=markdown-preview-handler.d.ts.map