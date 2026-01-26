import * as dntShim from "../../../../../_dnt.shims.js";
import type { HandlerContext, HandlerResult } from "../../types.js";
import { ResponseBuilder } from "../../../../security/index.js";
export declare function handleDataEndpoint(req: dntShim.Request, pathname: string, ctx: HandlerContext, createResponseBuilder: (ctx: HandlerContext) => ResponseBuilder, respond: (response: dntShim.Response) => HandlerResult, getErrorMessage: (error: unknown) => string): Promise<HandlerResult>;
//# sourceMappingURL=data-endpoint-handler.d.ts.map