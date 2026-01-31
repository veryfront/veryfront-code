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

  async getToken(
    scope: TokenScope,
    projectSlug?: string,
    customDomain?: string,
  ): Promise<string> {
    const projectKey = projectSlug || customDomain;
    const cacheKey = this.getCacheKey(scope, projectKey);

    return withSpan(
      ProxySpanNames.PROXY_TOKEN_FETCH,
      async () => {
        const cached = await this.cache.get(cacheKey);
        if (cached && this.isTokenValid(cached)) return cached.token;

        const pending = this.pendingRequests.get(cacheKey);
        if (pending) return pending;

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
        "proxy.project_slug": projectSlug ?? "",
        "proxy.custom_domain": customDomain ?? "",
        "proxy.cache_key": cacheKey,
      },
    );
  }

  async invalidateToken(scope: TokenScope, projectSlug?: string): Promise<void> {
    await this.cache.delete(this.getCacheKey(scope, projectSlug));
  }

  async clearCache(): Promise<void> {
    await this.cache.clear();
  }

  async getStats(): Promise<{ hits: number; misses: number; size: number; type: string }> {
    return this.cache.stats();
  }

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
    const isPreview = scope === "preview";
    const clientId = isPreview ? this.config.previewClientId : this.config.clientId;
    const clientSecret = isPreview ? this.config.previewClientSecret : this.config.clientSecret;

    const response = await fetchOAuthToken({
      apiBaseUrl: this.config.apiBaseUrl,
      clientId,
      clientSecret,
      projectSlug,
      customDomain,
    });

    const projectKey = projectSlug || customDomain;

    await this.cache.set(this.getCacheKey(scope, projectKey), {
      token: response.access_token,
      expiresAt: this.calculateExpiresAt(response),
      scope,
      projectSlug: projectKey,
    });

    return response.access_token;
  }

  private calculateExpiresAt(response: TokenResponse): number {
    if (response.expires_in) return Date.now() + response.expires_in * 1000;

    try {
      const payload = response.access_token.split(".")[1];
      if (!payload) return Date.now() + 3600 * 1000;

      const decoded = JSON.parse(atob(payload));
      if (decoded?.exp) return decoded.exp * 1000;
    } catch {
      // Fall through to default
    }

    return Date.now() + 3600 * 1000;
  }
}
