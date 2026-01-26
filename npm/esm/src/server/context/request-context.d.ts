import * as dntShim from "../../../_dnt.shims.js";
export interface EnvConfig {
    isLocalDev: boolean;
}
export declare function createEnvConfig(): EnvConfig;
export interface RequestContext {
    token: string;
    slug: string;
    branch: string | null;
    mode: "preview" | "production";
    isLocalDev: boolean;
}
export declare function createRequestContext(req: dntShim.Request, envConfig?: EnvConfig): RequestContext;
export declare function getCacheStrategy(ctx: RequestContext): "none" | "invalidate" | "immutable";
export declare function shouldEnableCache(ctx: RequestContext): boolean;
export declare function shouldUseNoCacheHeaders(ctx?: RequestContext): boolean;
//# sourceMappingURL=request-context.d.ts.map