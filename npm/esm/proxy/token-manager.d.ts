/**
 * Token Manager for OAuth Token Caching
 *
 * Manages OAuth tokens with automatic refresh before expiry.
 * Caches tokens per scope (preview/production) and project.
 * Supports pluggable cache backends (memory, Redis).
 */
import type { TokenCache } from "./cache/types.js";
export type TokenScope = "preview" | "production";
export interface OAuthConfig {
    apiBaseUrl: string;
    clientId: string;
    clientSecret: string;
    previewClientId: string;
    previewClientSecret: string;
}
export interface TokenManagerOptions {
    cache?: TokenCache;
    refreshBuffer?: number;
}
export declare class TokenManager {
    private config;
    private cache;
    private pendingRequests;
    private refreshBuffer;
    constructor(config: OAuthConfig, options?: TokenManagerOptions);
    /**
     * Get a valid token for the given scope and project.
     * Returns cached token if valid, otherwise fetches a new one.
     * Can use either projectSlug or customDomain to identify the project.
     */
    getToken(scope: TokenScope, projectSlug?: string, customDomain?: string): Promise<string>;
    /**
     * Invalidate a cached token, forcing refresh on next request.
     */
    invalidateToken(scope: TokenScope, projectSlug?: string): Promise<void>;
    /**
     * Clear all cached tokens.
     */
    clearCache(): Promise<void>;
    /**
     * Get cache statistics.
     */
    getStats(): Promise<{
        hits: number;
        misses: number;
        size: number;
        type: string;
    }>;
    /**
     * Close the cache connection (for Redis cleanup).
     */
    close(): Promise<void>;
    private getCacheKey;
    private isTokenValid;
    private fetchAndCacheToken;
    private calculateExpiresAt;
}
//# sourceMappingURL=token-manager.d.ts.map