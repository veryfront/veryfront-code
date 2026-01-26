/**
 * ResponseBuilder - Fluent methods for configuring response builder state
 */
import * as dntShim from "../../../../_dnt.shims.js";
import type { CacheStrategy, CORSConfig, SecurityConfig } from "./types.js";
export interface FluentMethodsContext {
    headers: dntShim.Headers;
    status: number;
    securityConfig: SecurityConfig | null;
    isDev: boolean;
    nonce: string;
    cspUserHeader: string | null;
    adapter: import("../../../platform/adapters/base.js").RuntimeAdapter | undefined;
    isVeryfrontDomain: boolean;
}
/** Apply CORS headers based on configuration */
export declare function withCORS<T extends FluentMethodsContext>(this: T, req: dntShim.Request, corsConfig?: boolean | CORSConfig): T;
/** Apply CORS headers asynchronously */
export declare function withCORSAsync<T extends FluentMethodsContext>(this: T, req: dntShim.Request): Promise<T>;
/** Apply security headers (CSP, COOP, CORP, COEP) */
export declare function withSecurity<T extends FluentMethodsContext>(this: T, config?: SecurityConfig): T;
/** Apply cache control headers based on strategy */
export declare function withCache<T extends FluentMethodsContext>(this: T, strategy: CacheStrategy): T;
/** Set ETag header */
export declare function withETag<T extends FluentMethodsContext>(this: T, etag: string): T;
/** Set custom headers */
export declare function withHeaders<T extends FluentMethodsContext>(this: T, headers: dntShim.HeadersInit | Record<string, string>): T;
/** Set response status */
export declare function withStatus<T extends FluentMethodsContext>(this: T, status: number): T;
/** Apply Client Hints headers for theme detection */
export declare function withClientHints<T extends FluentMethodsContext>(this: T): T;
/** Set Allow header for OPTIONS requests */
export declare function withAllow<T extends FluentMethodsContext>(this: T, methods: string | string[]): T;
//# sourceMappingURL=fluent-methods.d.ts.map