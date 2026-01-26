import * as dntShim from "../../../../../_dnt.shims.js";
import type { HandlerContext } from "../../types.js";
import type { ResponseBuilder } from "../../../../security/index.js";
interface ErrorPageOptions {
    statusCode: number;
    error?: Error;
    pathname?: string;
}
export declare function tryErrorPageFallback(req: dntShim.Request, ctx: HandlerContext, builder: ResponseBuilder, options: ErrorPageOptions): Promise<dntShim.Response | null>;
export {};
//# sourceMappingURL=error-page-fallback.d.ts.map