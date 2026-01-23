/**
 * Token Manager for OAuth Token Caching
 *
 * Manages OAuth tokens with automatic refresh before expiry.
 * Caches tokens per scope (preview/production) and project.
 * Supports pluggable cache backends (memory, Redis).
 */

import { fetchOAuthToken, type TokenResponse } from "./oauth-client.ts";
import type { TokenCache, TokenCacheEntry } from "./cache/types.ts";
import { MemoryCache } from "./cache/memory-cache.ts";
import { ProxySpanNames, withSpan } from "./tracing.ts";

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
  refreshBuffer?: number; // ms before expiry to trigger refresh
}

export class TokenManager {
  private cache: TokenCache;
  private pendingRequests = new Map<string, Promise<string>>();
  private refreshBuffer: number;

  constructor(
    private config: OAuthConfig,
    options: TokenManagerOptions = {},
  ) {
    this.cache = options.cache ?? new MemoryCache();
    this.refreshBuffer = options.refreshBuffer ?? 2 * 60 * 1000; // 2 minutes before expiry
  }

  /**
   * Get a valid token for the given scope and project.
   * Returns cached token if valid, otherwise fetches a new one.
   * Can use either projectSlug or customDomain to identify the project.
   */
  async getToken(
    scope: TokenScope,
    projectSlug?: string,
    customDomain?: string,
  ): Promise<string> {
    return await withSpan(
      ProxySpanNames.PROXY_TOKEN_FETCH,
      async () => {
        const cacheKey = this.getCacheKey(scope, projectSlug || customDomain);
        const cached = await this.cache.get(cacheKey);

        if (cached && this.isTokenValid(cached)) {
          return cached.token;
        }

        // Prevent duplicate concurrent requests for the same token
        const pending = this.pendingRequests.get(cacheKey);
        if (pending) {
          return pending;
        }

        const tokenPromise = this.fetchAndCacheToken(scope, projectSlug, customDomain);
        this.pendingRequests.set(cacheKey, tokenPromise);

        try {
          return await tokenPromise;
        } finally {
          this.pendingRequests.delete(cacheKey);
        }
      },
      {
        "proxy.token_scope": scope,
        "proxy.project_slug": projectSlug || "",
        "proxy.custom_domain": customDomain || "",
        "proxy.cache_key": this.getCacheKey(scope, projectSlug || customDomain),
      },
    );
  }

  /**
   * Invalidate a cached token, forcing refresh on next request.
   */
  async invalidateToken(scope: TokenScope, projectSlug?: string): Promise<void> {
    const cacheKey = this.getCacheKey(scope, projectSlug);
    await this.cache.delete(cacheKey);
  }

  /**
   * Clear all cached tokens.
   */
  async clearCache(): Promise<void> {
    await this.cache.clear();
  }

  /**
   * Get cache statistics.
   */
  async getStats(): Promise<{ hits: number; misses: number; size: number; type: string }> {
    return await this.cache.stats();
  }

  /**
   * Close the cache connection (for Redis cleanup).
   */
  async close(): Promise<void> {
    await this.cache.close();
  }

  private getCacheKey(scope: TokenScope, projectSlug?: string): string {
    return `${scope}:${projectSlug || "global"}`;
  }

  private isTokenValid(cached: TokenCacheEntry): boolean {
    return Date.now() + this.refreshBuffer < cached.expiresAt;
  }

  private async fetchAndCacheToken(
    scope: TokenScope,
    projectSlug?: string,
    customDomain?: string,
  ): Promise<string> {
    const clientId = scope === "preview" ? this.config.previewClientId : this.config.clientId;
    const clientSecret = scope === "preview"
      ? this.config.previewClientSecret
      : this.config.clientSecret;

    const response = await fetchOAuthToken({
      apiBaseUrl: this.config.apiBaseUrl,
      clientId,
      clientSecret,
      projectSlug,
      customDomain,
    });

    const expiresAt = this.calculateExpiresAt(response);

    await this.cache.set(this.getCacheKey(scope, projectSlug || customDomain), {
      token: response.access_token,
      expiresAt,
      scope,
      projectSlug: projectSlug || customDomain,
    });

    return response.access_token;
  }

  private calculateExpiresAt(response: TokenResponse): number {
    if (response.expires_in) {
      return Date.now() + response.expires_in * 1000;
    }

    // Try to decode JWT and get exp claim
    try {
      const [, payload] = response.access_token.split(".");
      if (payload) {
        const decoded = JSON.parse(atob(payload));
        if (decoded.exp) {
          return decoded.exp * 1000;
        }
      }
    } catch {
      // Fall through to default
    }

    // Default to 1 hour
    return Date.now() + 3600 * 1000;
  }
}
