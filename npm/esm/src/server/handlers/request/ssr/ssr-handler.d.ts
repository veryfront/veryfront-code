/**
 * Server-Side Rendering Handler
 *
 * Main handler for SSR pages and dynamic routes.
 * Orchestrates renderer, ETag handling, and not-found fallbacks.
 *
 * @module server/handlers/request/ssr/ssr-handler
 */
import * as dntShim from "../../../../../_dnt.shims.js";
import { BaseHandler } from "../../response/base.js";
import type { HandlerContext, HandlerMetadata, HandlerResult } from "../../types.js";
/**
 * Determine if request should serve production (released) content.
 * Uses resolvedEnvironment (from domain lookup) with fallback to requestContext.mode.
 * Config override (PRODUCTION_MODE) takes precedence.
 */
export declare function isProductionMode(ctx: HandlerContext, _url?: URL): boolean;
export declare class SSRHandler extends BaseHandler {
    metadata: HandlerMetadata;
    handle(req: dntShim.Request, ctx: HandlerContext): Promise<HandlerResult>;
    private handleWithContext;
}
//# sourceMappingURL=ssr-handler.d.ts.map