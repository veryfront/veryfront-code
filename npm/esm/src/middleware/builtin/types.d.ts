import * as dntShim from "../../../_dnt.shims.js";
export type Next = () => Promise<dntShim.Response | undefined> | dntShim.Response;
export interface MiddlewareContext {
    request: dntShim.Request;
}
export type Middleware = (ctx: MiddlewareContext, next: Next) => Promise<dntShim.Response | undefined> | dntShim.Response | undefined;
export type AnyMiddlewareContext = MiddlewareContext | {
    req: dntShim.Request;
} | {
    request: dntShim.Request;
};
export declare function getRequest(ctx: AnyMiddlewareContext): dntShim.Request;
export type OriginValidator = (origin: string) => boolean | Promise<boolean>;
export interface CorsOptions {
    origin?: string | string[] | OriginValidator;
    methods?: string[];
    allowedHeaders?: string[];
    exposedHeaders?: string[];
    credentials?: boolean;
    maxAge?: number;
}
export interface CorsValidationResult {
    allowedOrigin: string | null;
    allowCredentials: boolean;
    error?: string;
}
//# sourceMappingURL=types.d.ts.map