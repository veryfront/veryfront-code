import * as dntShim from "../../../../../_dnt.shims.js";
import type { HandlerContext, HandlerResult } from "../../types.js";
import { ResponseBuilder } from "../../../../security/index.js";
export declare function handleVirtualModule(req: dntShim.Request, ctx: HandlerContext, createResponseBuilder: (ctx: HandlerContext) => ResponseBuilder, respond: (response: dntShim.Response) => HandlerResult, getErrorMessage: (error: unknown) => string): Promise<HandlerResult>;
//# sourceMappingURL=virtual-module-handler.d.ts.map