import * as dntShim from "../../../_dnt.shims.js";
import type { RuntimeAdapter } from "../../platform/adapters/base.js";
import type { RouteMatch } from "./api-route-matcher.js";
import type { APIRoute } from "./module-loader/types.js";
export declare function executeAppRoute(handler: APIRoute, request: dntShim.Request, match: RouteMatch, pathname: string, adapter: RuntimeAdapter): Promise<dntShim.Response>;
export declare function executePagesRoute(handler: APIRoute, request: dntShim.Request, match: RouteMatch, pathname: string, adapter: RuntimeAdapter, projectDir?: string): Promise<dntShim.Response>;
//# sourceMappingURL=route-executor.d.ts.map