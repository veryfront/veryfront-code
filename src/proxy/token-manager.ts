import { fetchOAuthToken, type TokenResponse } from "./oauth-client.ts";
import type { TokenCache, TokenCacheEntry } from "./cache/types.ts";
import { MemoryCache } from "./cache/memory-cache.ts";
import { ProxySpanNames, withSpan } from "./tracing.ts";

export type TokenScope = "preview" | "production";

export interface OAuthConfig {
  apiBaseUrl: string;
  apiClientId: string;
  apiClientSecret: string;
  previewApiClientId: string;
  previewApiClientSecret: string;
}

export interface TokenManagerOptions {
  cache?: TokenCache;
  refreshBuffer?: number; // ms before expiry to trigger refresh
  negativeCacheTtl?: number; // ms to cache failed lookups (default: 5 minutes)
}

export class ProjectNotFoundError extends Error {
  constructor(public readonly domain: string) {
    super(`Project not found for domain: ${domain}`);
    this.name = "ProjectNotFoundError";
  }
}

interface NegativeCacheEntry {
  expiresAt: number;
}

export class TokenManager {
  private cache: TokenCache;
  private pendingRequests = new Map<string, Promise<string>>();
  private negativeCache = new Map<string, NegativeCacheEntry>();
  private refreshBuffer: number;
  private negativeCacheTtl: number;

  constructor(
    private config: OAuthConfig,
    options: TokenManagerOptions = {},
  ) {
    this.cache = options.cache ?? new MemoryCache();
    this.refreshBuffer = options.refreshBuffer ?? 2 * 60 * 1000; // 2 minutes before expiry
    this.negativeCacheTtl = options.negativeCacheTtl ?? 5 * 60 * 1000; // 5 minutes for failed lookups
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
        // Check negative cache first for custom domains
        if (customDomain) {
          const negativeCacheKey = this.getNegativeCacheKey(customDomain);
          const negativeEntry = this.negativeCache.get(negativeCacheKey);
          if (negativeEntry && Date.now() < negativeEntry.expiresAt) {
            throw new ProjectNotFoundError(customDomain);
          }
          // Clean up expired negative cache entry
          if (negativeEntry) {
            this.negativeCache.delete(negativeCacheKey);
          }
        }

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
    this.negativeCache.clear();
  }

  clearNegativeCache(): void {
    this.negativeCache.clear();
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

  private getNegativeCacheKey(domain: string): string {
    return `negative:${domain.toLowerCase()}`;
  }

  private addToNegativeCache(domain: string): void {
    const key = this.getNegativeCacheKey(domain);
    this.negativeCache.set(key, {
      expiresAt: Date.now() + this.negativeCacheTtl,
    });
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
    const apiClientId = isPreview ? this.config.previewApiClientId : this.config.apiClientId;
    const apiClientSecret = isPreview
      ? this.config.previewApiClientSecret
      : this.config.apiClientSecret;

    try {
      const response = await fetchOAuthToken({
        apiBaseUrl: this.config.apiBaseUrl,
        apiClientId,
        apiClientSecret,
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
    } catch (error) {
      // Cache "Project not found" errors for custom domains to avoid repeated API calls
      if (
        customDomain &&
        error instanceof Error &&
        error.message.includes("Project not found")
      ) {
        this.addToNegativeCache(customDomain);
        throw new ProjectNotFoundError(customDomain);
      }
      throw error;
    }
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
