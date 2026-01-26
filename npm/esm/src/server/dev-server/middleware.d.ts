import * as dntShim from "../../../_dnt.shims.js";
import { MiddlewarePipeline } from "../../middleware/core/pipeline/index.js";
import type { VeryfrontConfig } from "../../config/index.js";
import type { RuntimeAdapter } from "../../platform/adapters/base.js";
type MiddlewareFunction = (c: {
    req: dntShim.Request;
    var: Record<string, unknown>;
}, next: () => Promise<dntShim.Response | undefined> | dntShim.Response) => Promise<dntShim.Response | undefined> | dntShim.Response | undefined;
export declare function createRequestLoggerMiddleware(): MiddlewareFunction;
export declare function setupMiddleware(pipeline: MiddlewarePipeline, config: VeryfrontConfig, requestHandler: (req: dntShim.Request) => Promise<dntShim.Response>, projectDir?: string, adapter?: RuntimeAdapter): Promise<void>;
export {};
//# sourceMappingURL=middleware.d.ts.map