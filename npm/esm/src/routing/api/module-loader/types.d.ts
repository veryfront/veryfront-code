import * as dntShim from "../../../../_dnt.shims.js";
import type { RuntimeAdapter } from "../../../platform/adapters/base.js";
import type { APIContext } from "../context-builder.js";
import type { VeryfrontConfig } from "../../../config/index.js";
export interface AppRouteContext {
    params: Record<string, string>;
}
export type HTTPMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS";
export type PagesRouteHandler = (ctx: APIContext) => Promise<dntShim.Response> | dntShim.Response;
export type AppRouteHandler = (request: dntShim.Request, context: AppRouteContext) => Promise<dntShim.Response> | dntShim.Response;
export type RouteHandler = PagesRouteHandler | AppRouteHandler;
export type APIRoute = Partial<Record<HTTPMethod, RouteHandler>> & {
    default?: RouteHandler;
};
export interface LoadModuleOptions {
    projectDir: string;
    modulePath: string;
    adapter: RuntimeAdapter;
    config?: VeryfrontConfig;
}
//# sourceMappingURL=types.d.ts.map