import * as dntShim from "../../../../../_dnt.shims.js";
import type { HandlerContext } from "../../types.js";
import type { ResponseBuilder } from "../../../../security/index.js";
export declare function tryNotFoundFallback(req: dntShim.Request, slug: string, ctx: HandlerContext, builder: ResponseBuilder): Promise<dntShim.Response | null>;
//# sourceMappingURL=not-found-fallback.d.ts.map