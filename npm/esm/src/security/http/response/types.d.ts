/**
 * Response Builder Types
 * Type definitions for response construction
 */
export type { CORSConfig } from "../cors/index.js";
/**
 * HSTS Configuration
 */
export interface HSTSConfig {
    maxAge: number;
    includeSubDomains?: boolean;
    preload?: boolean;
}
/**
 * Security Configuration Interface
 */
export interface SecurityConfig {
    cors?: boolean | import("../cors/index.js").CORSConfig;
    csp?: Partial<Record<string, string | string[]>>;
    coop?: "same-origin" | "same-origin-allow-popups" | "unsafe-none";
    corp?: "same-origin" | "same-site" | "cross-origin";
    coep?: "require-corp" | "unsafe-none";
    hsts?: HSTSConfig;
    headers?: Record<string, string>;
    remoteHosts?: string[];
    [key: string]: unknown;
}
/**
 * Cache strategy configuration
 */
export type CacheStrategy = "no-cache" | "no-store" | "short" | "medium" | "long" | "immutable" | "none" | {
    maxAge: number;
    public?: boolean;
    immutable?: boolean;
    mustRevalidate?: boolean;
};
/**
 * Response builder configuration
 */
export interface ResponseBuilderConfig {
    securityConfig?: SecurityConfig | null;
    isDev?: boolean;
    cspUserHeader?: string | null;
    adapter?: import("../../../platform/adapters/base.js").RuntimeAdapter;
    nonce?: string;
    isVeryfrontDomain?: boolean;
}
//# sourceMappingURL=types.d.ts.map