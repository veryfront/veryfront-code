import * as dntShim from "../../../_dnt.shims.js";
import type { RuntimeAdapter } from "../../platform/adapters/base.js";
import { type APIContext } from "./context-builder.js";
import type { APIRoute } from "./module-loader/types.js";
export type { APIContext, APIRoute };
export interface APIResponse {
    body?: unknown;
    status?: number;
    headers?: dntShim.HeadersInit;
}
export type APIHandler = (ctx: APIContext) => Promise<dntShim.Response> | dntShim.Response;
export declare class APIRouteHandler {
    private projectDir;
    private router;
    private routeCache;
    private lastErrorMessage;
    private adapter;
    private adapterPromise;
    private corsConfig;
    private corsConfigLoaded;
    private corsConfigPromise;
    private config;
    private configPromise;
    constructor(projectDir: string, adapter?: RuntimeAdapter);
    initialize(): Promise<void>;
    handle(request: dntShim.Request): Promise<dntShim.Response | null>;
    private loadHandler;
    clearCache(): void;
    destroy(): void;
    private ensureAdapter;
    private ensureCorsConfig;
    private loadCorsConfig;
    private ensureConfig;
    private loadFullConfig;
}
export { badRequest, forbidden, internalServerError as serverError, jsonResponse as json, notFound, redirectResponse as redirect, unauthorized, } from "../../platform/compat/http/responses.js";
//# sourceMappingURL=handler.d.ts.map