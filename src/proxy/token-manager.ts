import { fetchOAuthToken, OAuthTokenRequestError, type TokenResponse } from "./oauth-client.ts";
import type { TokenCache, TokenCacheEntry } from "./cache/types.ts";
import { MemoryCache } from "./cache/memory-cache.ts";
import { ProxySpanNames, withSpan } from "./tracing.ts";

export type TokenScope = "preview" | "production";

interface NegativeCacheEntry {
  status: number;
  responseText: string;
  cachedAt: number;
}

const NEGATIVE_CACHE_TTL_MS = 5 * 60 * 1_000; // 5 minutes
const NEGATIVE_CACHE_MAX_SIZE = 1_000;
const DEFAULT_REFRESH_BUFFER_MS = 2 * 60 * 1_000; // 2 minutes before expiry
const DEFAULT_TOKEN_TTL_MS = 3_600 * 1_000; // 1 hour
const MAX_REFRESH_BUFFER_MS = 60 * 60 * 1_000;
const MAX_TOKEN_IDENTITY_LENGTH = 512;
const MAX_JWT_PAYLOAD_LENGTH = 64 * 1024;
const MAX_TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1_000;

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

interface PendingTokenRequest {
  controller: AbortController;
  globalGeneration: number;
  generation: number;
  promise: Promise<string>;
}

export class TokenFetchSupersededError extends Error {
  constructor() {
    super("OAuth token fetch was superseded");
    this.name = "TokenFetchSupersededError";
  }
}

function containsAsciiControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export class TokenManager {
  private cache: TokenCache;
  private pendingRequests = new Map<string, PendingTokenRequest>();
  private negativeCache = new Map<string, NegativeCacheEntry>();
  private refreshBuffer: number;
  private invalidations = new Map<string, Promise<void>>();
  private keyGenerations = new Map<string, number>();
  private globalGeneration = 0;
  private maintenancePromise: Promise<void> | null = null;
  private closePromise: Promise<void> | null = null;
  private closed = false;

  constructor(
    private config: OAuthConfig,
    options: TokenManagerOptions = {},
  ) {
    this.cache = options.cache ?? new MemoryCache();
    this.refreshBuffer = options.refreshBuffer ?? DEFAULT_REFRESH_BUFFER_MS;
    if (
      !Number.isSafeInteger(this.refreshBuffer) ||
      this.refreshBuffer < 0 ||
      this.refreshBuffer > MAX_REFRESH_BUFFER_MS
    ) {
      throw new RangeError(
        `Token refresh buffer must be an integer between 0 and ${MAX_REFRESH_BUFFER_MS}ms`,
      );
    }
  }

  async getToken(
    scope: TokenScope,
    projectSlug?: string,
    customDomain?: string,
  ): Promise<string> {
    this.assertOpen();
    const cacheKey = this.getCacheKey(scope, projectSlug, customDomain);

    return withSpan(
      ProxySpanNames.PROXY_TOKEN_FETCH,
      async () => {
        if (this.maintenancePromise) {
          await this.maintenancePromise;
          this.assertOpen();
        }
        const invalidation = this.invalidations.get(cacheKey);
        if (invalidation) {
          await invalidation;
          this.assertOpen();
        }
        const globalGeneration = this.globalGeneration;
        const generation = this.getGeneration(cacheKey);

        // Fast path: if a fetch is already in flight, return it immediately
        const existing = this.pendingRequests.get(cacheKey);
        if (
          existing?.globalGeneration === globalGeneration &&
          existing.generation === generation
        ) {
          return existing.promise;
        }

        const negEntry = this.negativeCache.get(cacheKey);
        if (negEntry) {
          if (Date.now() - negEntry.cachedAt < NEGATIVE_CACHE_TTL_MS) {
            // Rethrow the structured token error (not a generic cache error) so
            // callers can classify the cached failure by `.status`/response text
            // exactly as they would a fresh failure, without scraping messages.
            throw new OAuthTokenRequestError(negEntry.status, negEntry.responseText);
          }
          this.negativeCache.delete(cacheKey);
        }

        const cached = await this.cache.get(cacheKey);
        this.assertOpen();
        if (!this.isGenerationCurrent(cacheKey, globalGeneration, generation)) {
          throw new TokenFetchSupersededError();
        }
        if (cached) {
          const cachedToken = this.readValidCachedToken(cached, scope);
          if (cachedToken !== undefined) return cachedToken;
          await this.cache.delete(cacheKey);
          this.assertOpen();
          if (!this.isGenerationCurrent(cacheKey, globalGeneration, generation)) {
            throw new TokenFetchSupersededError();
          }
        }

        // Re-check after await: another concurrent call may have started a fetch
        const pending = this.pendingRequests.get(cacheKey);
        if (
          pending?.globalGeneration === globalGeneration &&
          pending.generation === generation
        ) {
          return pending.promise;
        }

        const controller = new AbortController();
        const tokenPromise = this.fetchAndCacheToken(
          scope,
          cacheKey,
          globalGeneration,
          generation,
          controller.signal,
          projectSlug,
          customDomain,
        );
        const pendingRequest: PendingTokenRequest = {
          controller,
          globalGeneration,
          generation,
          promise: tokenPromise,
        };
        this.pendingRequests.set(cacheKey, pendingRequest);

        try {
          return await tokenPromise;
        } finally {
          if (this.pendingRequests.get(cacheKey) === pendingRequest) {
            this.pendingRequests.delete(cacheKey);
          }
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

  invalidateToken(
    scope: TokenScope,
    projectSlug?: string,
    customDomain?: string,
  ): Promise<void> {
    this.assertOpen();
    const cacheKey = this.getCacheKey(scope, projectSlug, customDomain);
    const existing = this.invalidations.get(cacheKey);
    if (existing) return existing;

    const invalidation = this.performInvalidation(cacheKey).finally(() => {
      if (this.invalidations.get(cacheKey) === invalidation) {
        this.invalidations.delete(cacheKey);
      }
    });
    this.invalidations.set(cacheKey, invalidation);
    return invalidation;
  }

  clearCache(): Promise<void> {
    this.assertOpen();
    if (this.maintenancePromise) return this.maintenancePromise;
    const maintenance = this.performClear().finally(() => {
      if (this.maintenancePromise === maintenance) this.maintenancePromise = null;
    });
    this.maintenancePromise = maintenance;
    return maintenance;
  }

  private async performClear(): Promise<void> {
    this.globalGeneration++;
    for (const cacheKey of this.pendingRequests.keys()) this.bumpGeneration(cacheKey);
    const pending = [...this.pendingRequests.values()];
    for (const request of pending) {
      request.controller.abort(new TokenFetchSupersededError());
    }
    await Promise.allSettled(pending.map((request) => request.promise));
    this.negativeCache.clear();
    await this.cache.clear();
    this.keyGenerations.clear();
  }

  async getStats(): Promise<{ hits: number; misses: number; size: number; type: string }> {
    return this.cache.stats();
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    const pending = [...this.pendingRequests.values()];
    for (const cacheKey of this.pendingRequests.keys()) this.bumpGeneration(cacheKey);
    for (const request of pending) {
      request.controller.abort(new TokenFetchSupersededError());
    }
    const close = (async () => {
      await Promise.allSettled([
        ...pending.map((request) => request.promise),
        ...this.invalidations.values(),
        ...(this.maintenancePromise ? [this.maintenancePromise] : []),
      ]);
      this.negativeCache.clear();
      await this.cache.close();
    })();
    this.closePromise = close;
    return close;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Token manager is closed");
  }

  private normalizeIdentity(value: string, label: string): string {
    const normalized = value.trim().toLowerCase();
    if (
      value !== normalized ||
      normalized.length === 0 ||
      normalized.length > MAX_TOKEN_IDENTITY_LENGTH ||
      containsAsciiControlCharacter(normalized)
    ) {
      throw new TypeError(`${label} is not a valid token cache identity`);
    }
    return normalized;
  }

  private getCacheKey(
    scope: TokenScope,
    projectSlug?: string,
    customDomain?: string,
  ): string {
    if (scope !== "preview" && scope !== "production") {
      throw new TypeError("Token scope must be preview or production");
    }
    if (projectSlug !== undefined && customDomain !== undefined) {
      throw new TypeError("Token identity cannot contain both a project slug and custom domain");
    }
    if (projectSlug !== undefined) {
      return JSON.stringify([
        scope,
        "project",
        this.normalizeIdentity(projectSlug, "Project slug"),
      ]);
    }
    if (customDomain !== undefined) {
      return JSON.stringify([
        scope,
        "domain",
        this.normalizeIdentity(customDomain, "Custom domain"),
      ]);
    }
    return JSON.stringify([scope, "global", ""]);
  }

  private getGeneration(cacheKey: string): number {
    return this.keyGenerations.get(cacheKey) ?? 0;
  }

  private isGenerationCurrent(
    cacheKey: string,
    globalGeneration: number,
    generation: number,
  ): boolean {
    return globalGeneration === this.globalGeneration &&
      generation === this.getGeneration(cacheKey);
  }

  private bumpGeneration(cacheKey: string): void {
    this.keyGenerations.set(cacheKey, this.getGeneration(cacheKey) + 1);
  }

  private async performInvalidation(cacheKey: string): Promise<void> {
    this.bumpGeneration(cacheKey);
    this.negativeCache.delete(cacheKey);
    const pending = this.pendingRequests.get(cacheKey);
    if (pending) {
      pending.controller.abort(new TokenFetchSupersededError());
      await Promise.allSettled([pending.promise]);
    }
    await this.cache.delete(cacheKey);
    this.keyGenerations.delete(cacheKey);
  }

  private readValidCachedToken(
    cached: TokenCacheEntry,
    expectedScope: TokenScope,
  ): string | undefined {
    try {
      const descriptors = Object.getOwnPropertyDescriptors(cached);
      const tokenDescriptor = descriptors.token;
      const expiresAtDescriptor = descriptors.expiresAt;
      const scopeDescriptor = descriptors.scope;
      const token = tokenDescriptor && "value" in tokenDescriptor
        ? tokenDescriptor.value
        : undefined;
      const expiresAt = expiresAtDescriptor && "value" in expiresAtDescriptor
        ? expiresAtDescriptor.value
        : undefined;
      const scope = scopeDescriptor && "value" in scopeDescriptor
        ? scopeDescriptor.value
        : undefined;
      const now = Date.now();
      if (
        typeof token !== "string" ||
        token.length === 0 ||
        token.length > 64 * 1024 ||
        typeof expiresAt !== "number" ||
        !Number.isSafeInteger(expiresAt) ||
        expiresAt <= now + this.refreshBuffer ||
        expiresAt > now + MAX_TOKEN_TTL_MS ||
        scope !== expectedScope
      ) {
        return undefined;
      }
      return token;
    } catch {
      return undefined;
    }
  }

  private async fetchAndCacheToken(
    scope: TokenScope,
    cacheKey: string,
    globalGeneration: number,
    generation: number,
    signal: AbortSignal,
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
        signal,
      });
    } catch (error) {
      if (
        error instanceof OAuthTokenRequestError &&
        (error.status === 400 || error.status === 404) &&
        this.isGenerationCurrent(cacheKey, globalGeneration, generation) &&
        !signal.aborted
      ) {
        if (this.negativeCache.size >= NEGATIVE_CACHE_MAX_SIZE) {
          const oldest = this.negativeCache.keys().next().value;
          if (oldest !== undefined) this.negativeCache.delete(oldest);
        }
        this.negativeCache.set(cacheKey, {
          status: error.status,
          responseText: error.responseText,
          cachedAt: Date.now(),
        });
      }
      throw error;
    }

    if (
      !this.isGenerationCurrent(cacheKey, globalGeneration, generation) ||
      signal.aborted
    ) {
      throw new TokenFetchSupersededError();
    }
    await this.cache.set(cacheKey, {
      token: response.access_token,
      expiresAt: this.calculateExpiresAt(response),
      scope,
      projectSlug: projectSlug ?? customDomain,
    });
    if (
      !this.isGenerationCurrent(cacheKey, globalGeneration, generation) ||
      signal.aborted
    ) {
      await this.cache.delete(cacheKey);
      throw new TokenFetchSupersededError();
    }

    return response.access_token;
  }

  private calculateExpiresAt(response: TokenResponse): number {
    const now = Date.now();
    if (response.expires_in !== undefined) {
      return Math.min(now + response.expires_in * 1000, now + MAX_TOKEN_TTL_MS);
    }

    try {
      const payload = response.access_token.split(".")[1];
      if (!payload || payload.length > MAX_JWT_PAYLOAD_LENGTH) {
        return now + DEFAULT_TOKEN_TTL_MS;
      }
      const normalized = payload.replaceAll("-", "+").replaceAll("_", "/").padEnd(
        Math.ceil(payload.length / 4) * 4,
        "=",
      );
      const decoded: unknown = JSON.parse(atob(normalized));
      const exp = decoded && typeof decoded === "object" && !Array.isArray(decoded)
        ? (decoded as Record<string, unknown>).exp
        : undefined;
      if (
        typeof exp === "number"
      ) {
        const expiresAt = exp * 1000;
        if (Number.isSafeInteger(expiresAt) && expiresAt > now) {
          return Math.min(expiresAt, now + MAX_TOKEN_TTL_MS);
        }
      }
    } catch {
      // expected: malformed JWT payload, fall through to default
    }

    return now + DEFAULT_TOKEN_TTL_MS;
  }
}
