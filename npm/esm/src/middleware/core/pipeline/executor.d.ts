import * as dntShim from "../../../../_dnt.shims.js";
import type { ExecutionContext, MiddlewareHandler } from "../types.js";
import type { RuntimeAdapter } from "../../../platform/adapters/base.js";
export declare function executeMiddlewarePipeline(req: dntShim.Request, composedMiddleware: MiddlewareHandler, env?: Record<string, unknown>, executionCtx?: ExecutionContext, adapter?: RuntimeAdapter): Promise<dntShim.Response>;
//# sourceMappingURL=executor.d.ts.map