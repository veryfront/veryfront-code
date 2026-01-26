import * as dntShim from "../../../../_dnt.shims.js";
import { BaseHandler } from "../response/base.js";
import type { HandlerContext, HandlerMetadata, HandlerResult } from "../types.js";
export declare class MemoryDebugHandler extends BaseHandler {
    metadata: HandlerMetadata;
    handle(req: dntShim.Request, ctx: HandlerContext): Promise<HandlerResult>;
    private getSecurityOptions;
    private jsonResponse;
    private handleFullSnapshot;
    private handleHeapStats;
    private handleCacheStats;
    private handleGC;
    private handlePressureCheck;
    private getRecommendations;
}
//# sourceMappingURL=memory.d.ts.map