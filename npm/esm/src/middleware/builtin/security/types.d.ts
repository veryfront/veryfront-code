export type CSPDirectives = Record<string, string>;
export interface SecurityHeadersOptions {
    contentSecurityPolicy?: string | CSPDirectives;
    xssProtection?: boolean;
    noSniff?: boolean;
    frameOptions?: "DENY" | "SAMEORIGIN" | string;
    hsts?: {
        maxAge: number;
        includeSubDomains?: boolean;
        preload?: boolean;
    };
    referrerPolicy?: string;
    permissionsPolicy?: string;
}
export interface CSPOptions {
    nonce?: string;
    merge?: string;
}
export interface CORSOptions {
    origin?: string;
}
export interface RateLimitEntry {
    count: number;
    resetAt: number;
}
export interface RateLimitStore {
    increment(key: string, windowMs: number): Promise<RateLimitEntry>;
    reset(key: string): Promise<void>;
}
//# sourceMappingURL=types.d.ts.map