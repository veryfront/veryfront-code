/**
 * API Handler Types
 *
 * Type definitions for API handler modules.
 */
import * as dntShim from "../../../../../_dnt.shims.js";
export type { AppRouteMatch, RouteHandlerModule } from "../../types.js";
export type HandlerFn = (req: dntShim.Request, ctx: {
    params: Record<string, string | string[]>;
}) => Promise<dntShim.Response> | dntShim.Response;
//# sourceMappingURL=types.d.ts.map