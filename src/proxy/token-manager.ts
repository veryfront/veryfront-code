import { fetchOAuthToken, type TokenResponse } from "./oauth-client.ts";
import type { TokenCache, TokenCacheEntry } from "./cache/types.ts";
import { MemoryCache } from "./cache/memory-cache.ts";
import { ProxySpanNames, withSpan } from "./tracing.ts";
import { CACHE_ERROR } from "#veryfront/errors";

export type TokenScope = "preview" | "production";

interface NegativeCacheEntry {
  status: number;
  message: string;
  cachedAt: number;
}

const NEGATIVE_CACHE_TTL_MS = 5 * 60 * 1_000; // 5 minutes
const NEGATIVE_CACHE_MAX_SIZE = 1_000;
const DEFAULT_REFRESH_BUFFER_MS = 2 * 60 * 1_000; // 2 minutes before expiry
const DEFAULT_TOKEN_TTL_MS = 3_600 * 1_000; // 1 hour

export interface OAuthConfig {
  apiBaseUrl: string;
  apiClientId: string;
  apiClientSecret: string;
  previewApiClientId: string;
  previewApiClientSecret: string;
}

interface TokenManagerOptions {
  cache?: TokenCache;
  refreshBuffer?: number; // ms before expiry to trigger refresh
}

export class TokenManager {
  private cache: TokenCache;
  private pendingRequests = new Map<string, Promise<string>>();
  private negativeCache = new Map<string, NegativeCacheEntry>();
  private refreshBuffer: number;

  constructor(
    private config: OAuthConfig,
    options: TokenManagerOptions = {},
  ) {
    this.cache = options.cache ?? new MemoryCache();
    this.refreshBuffer = options.refreshBuffer ?? DEFAULT_REFRESH_BUFFER_MS;
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
        // Fast path: if a fetch is already in flight, return it immediately
        const existing = this.pendingRequests.get(cacheKey);
        if (existing) return existing;

        const negEntry = this.negativeCache.get(cacheKey);
        if (negEntry) {
          if (Date.now() - negEntry.cachedAt < NEGATIVE_CACHE_TTL_MS) {
            throw CACHE_ERROR.create({ detail: negEntry.message });
          }
          this.negativeCache.delete(cacheKey);
        }

        const cached = await this.cache.get(cacheKey);
        if (cached && this.isTokenValid(cached)) return cached.token;

        // Re-check after await: another concurrent call may have started a fetch
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
    const cacheKey = this.getCacheKey(scope, projectSlug);
    this.negativeCache.delete(cacheKey);
    await this.cache.delete(cacheKey);
  }

  async clearCache(): Promise<void> {
    this.negativeCache.clear();
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
    const apiClientId = isPreview ? this.config.previewApiClientId : this.config.apiClientId;
    const apiClientSecret = isPreview
      ? this.config.previewApiClientSecret
      : this.config.apiClientSecret;

    let response: TokenResponse;
    try {
      response = await fetchOAuthToken({
        apiBaseUrl: this.config.apiBaseUrl,
        apiClientId,
        apiClientSecret,
        projectSlug,
        customDomain,
      });
    } catch (error) {
      const status = this.parseStatusFromError(error);
      if (status === 400 || status === 404) {
        const projectKey = projectSlug || customDomain;
        const cacheKey = this.getCacheKey(scope, projectKey);
        if (this.negativeCache.size >= NEGATIVE_CACHE_MAX_SIZE) {
          const oldest = this.negativeCache.keys().next().value;
          if (oldest !== undefined) this.negativeCache.delete(oldest);
        }
        this.negativeCache.set(cacheKey, {
          status,
          message: error instanceof Error ? error.message : String(error),
          cachedAt: Date.now(),
        });
      }
      throw error;
    }

    const projectKey = projectSlug || customDomain;

    await this.cache.set(this.getCacheKey(scope, projectKey), {
      token: response.access_token,
      expiresAt: this.calculateExpiresAt(response),
      scope,
      projectSlug: projectKey,
    });

    return response.access_token;
  }

  private parseStatusFromError(error: unknown): number | null {
    const message = error instanceof Error ? error.message : String(error);
    const match = message.match(/failed: (\d+)/);
    return match ? Number(match[1]) : null;
  }

  private calculateExpiresAt(response: TokenResponse): number {
    if (response.expires_in) return Date.now() + response.expires_in * 1000;

    try {
      const payload = response.access_token.split(".")[1];
      if (!payload) return Date.now() + DEFAULT_TOKEN_TTL_MS;

      const decoded = JSON.parse(atob(payload));
      if (decoded?.exp) return decoded.exp * 1000;
    } catch (_) {
      // expected: malformed JWT payload, fall through to default
    }

    return Date.now() + DEFAULT_TOKEN_TTL_MS;
  }
}
