/**
 * Debug Context Handler
 *
 * Shows the current request context for debugging token/context propagation issues.
 * Available in all modes - endpoint is internal-only (not publicly routable).
 *
 * Endpoint: /_vf_debug/context
 */
import * as dntShim from "../../../../_dnt.shims.js";
import { BaseHandler } from "../response/base.js";
import type { HandlerContext, HandlerMetadata, HandlerResult } from "../types.js";
export declare class DebugContextHandler extends BaseHandler {
    metadata: HandlerMetadata;
    handle(req: dntShim.Request, ctx: HandlerContext): Promise<HandlerResult>;
    private checkMultiProjectMode;
    private getManagerStats;
}
//# sourceMappingURL=debug-context.d.ts.map