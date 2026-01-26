/**
 * API Handler Wrapper
 *
 * Main handler class that wraps API route handling for both Pages Router and App Router.
 */
import * as dntShim from "../../../../../_dnt.shims.js";
import { BaseHandler } from "../../response/base.js";
import type { HandlerContext, HandlerMetadata, HandlerResult } from "../../types.js";
/**
 * API handler wrapper for Pages and App Router
 *
 * Handles:
 * - Pages Router API routes (/api/*)
 * - App Router route.ts handlers
 *
 * @example
 * ```ts
 * const handler = new ApiHandlerWrapper(projectDir, adapter);
 * const result = await handler.handle(request, context);
 * ```
 */
export declare class ApiHandlerWrapper extends BaseHandler {
    private projectDir;
    private adapter;
    private initPromise;
    metadata: HandlerMetadata;
    constructor(projectDir: string, adapter: import("../../../../platform/adapters/base.js").RuntimeAdapter);
    /**
     * Pre-initialize the API handler to discover routes before any requests
     * Call this after construction to avoid first-request 404s
     */
    initialize(): Promise<void>;
    /**
     * Handles incoming requests for API routes
     *
     * @param req - The incoming request
     * @param ctx - Handler context
     * @returns Handler result (respond or continue)
     */
    handle(req: dntShim.Request, ctx: HandlerContext): Promise<HandlerResult>;
    /**
     * Internal handler that runs within project context
     */
    private handleWithContext;
}
//# sourceMappingURL=api-handler-wrapper.d.ts.map