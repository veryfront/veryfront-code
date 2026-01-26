import * as dntShim from "../../../../_dnt.shims.js";
import { BaseHandler } from "../response/base.js";
import type { HandlerContext, HandlerMetadata, HandlerResult } from "../types.js";
export declare function setServerInitialized(ready: boolean): void;
export declare function isServerInitialized(): boolean;
export declare class HealthHandler extends BaseHandler {
    metadata: HandlerMetadata;
    private checkReadiness;
    handle(req: dntShim.Request, ctx: HandlerContext): Promise<HandlerResult>;
    private hasDistDirectory;
}
//# sourceMappingURL=health.d.ts.map