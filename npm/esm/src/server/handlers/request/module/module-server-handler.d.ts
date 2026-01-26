import * as dntShim from "../../../../../_dnt.shims.js";
import type { HandlerContext, HandlerResult } from "../../types.js";
import { ResponseBuilder } from "../../../../security/index.js";
export declare function handleModuleServer(req: dntShim.Request, ctx: HandlerContext, createResponseBuilder: (ctx: HandlerContext) => ResponseBuilder, respond: (response: dntShim.Response) => HandlerResult, logDebug: (message: string, data: Record<string, unknown>, ctx: HandlerContext) => void, getErrorMessage: (error: unknown) => string): Promise<HandlerResult>;
//# sourceMappingURL=module-server-handler.d.ts.map