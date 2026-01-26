import * as dntShim from "../../../../_dnt.shims.js";
import type { CacheStrategy, CORSConfig, SecurityConfig } from "./types.js";
type ResponseBuilderConstructor = new (config?: {
    securityConfig?: SecurityConfig | null;
    isDev?: boolean;
    cspUserHeader?: string | null;
    adapter?: import("../../../platform/adapters/base.js").RuntimeAdapter;
}) => ResponseBuilderInstance;
interface ResponseBuilderInstance {
    headers: dntShim.Headers;
    status: number;
    withCORS(req: dntShim.Request, corsConfig?: boolean | CORSConfig): any;
    withSecurity(config?: SecurityConfig): any;
    withCache(strategy: CacheStrategy): any;
    withETag(etag: string): any;
    withAllow(methods: string | string[]): any;
    json(data: unknown, status?: number): dntShim.Response;
    html(body: string, status?: number): dntShim.Response;
    text(message: string, status?: number): dntShim.Response;
    withContentType(contentType: string, body?: dntShim.BodyInit | null): dntShim.Response;
    build(body?: dntShim.BodyInit | null, status?: number): dntShim.Response;
}
/** Set ResponseBuilder class reference (called by builder.ts to avoid circular deps) */
export declare function setResponseBuilderClass(builderClass: ResponseBuilderConstructor): void;
export declare function error(status: number, message: string, req: dntShim.Request, config?: {
    securityConfig?: SecurityConfig | null;
    corsConfig?: boolean | CORSConfig;
    contentType?: string;
}): dntShim.Response;
export declare function json(data: unknown, req: dntShim.Request, config?: {
    status?: number;
    securityConfig?: SecurityConfig | null;
    corsConfig?: boolean | CORSConfig;
    cache?: CacheStrategy;
    etag?: string;
}): dntShim.Response;
export declare function html(body: string, req: dntShim.Request, config?: {
    status?: number;
    securityConfig?: SecurityConfig | null;
    corsConfig?: boolean | CORSConfig;
    cache?: CacheStrategy;
    etag?: string;
}): dntShim.Response;
export declare function preflight(req: dntShim.Request, config?: {
    allowMethods?: string | string[];
    allowHeaders?: string | string[];
    securityConfig?: SecurityConfig | null;
    corsConfig?: boolean | CORSConfig;
}): dntShim.Response;
export declare function stream(streamData: ReadableStream, req: dntShim.Request, config?: {
    contentType?: string;
    securityConfig?: SecurityConfig | null;
    corsConfig?: boolean | CORSConfig;
    cache?: CacheStrategy;
}): dntShim.Response;
export {};
//# sourceMappingURL=static-helpers.d.ts.map