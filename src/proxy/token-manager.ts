import { fetchOAuthToken, OAuthTokenRequestError, type TokenResponse } from "./oauth-client.ts";
import type { CacheStats, TokenCache, TokenCacheEntry } from "./cache/types.ts";
import { MemoryCache } from "./cache/memory-cache.ts";
import { ProxySpanNames, withSpan } from "./tracing.ts";

export { OAuthTokenRequestError } from "./oauth-client.ts";
export type { OAuthTokenErrorReason } from "./oauth-client.ts";
export type { CacheStats, TokenCache, TokenCacheEntry } from "./cache/types.ts";

/** Proxy token environment. */
export type TokenScope = "preview" | "production";

type NegativeCacheKind = "oauth-request" | "missing-custom-domain-project";

interface NegativeCacheEntry {
  status: number;
  responseText: string;
  cachedAt: number;
  kind: NegativeCacheKind;
}

interface PendingTokenRequest {
  promise: Promise<string>;
  lifecycleBarriers: readonly Promise<void>[];
}

const NEGATIVE_CACHE_TTL_MS = 5 * 60 * 1_000;
const NEGATIVE_CACHE_MAX_SIZE = 1_000;
const DEFAULT_REFRESH_BUFFER_MS = 2 * 60 * 1_000;
const DEFAULT_TOKEN_TTL_MS = 3_600 * 1_000;
const MAX_REFRESH_BUFFER_MS = 24 * 60 * 60 * 1_000;
const MAX_TOKEN_IDENTITY_LENGTH = 960;
const MAX_CONFIG_VALUE_LENGTH = 65_536;
const MAX_API_BASE_URL_LENGTH = 4_096;

/** OAuth credentials used to mint proxy service tokens. */
export interface OAuthConfig {
  /** Veryfront API base URL. */
  apiBaseUrl: string;
  /** Production client identifier, or an empty string when unconfigured. */
  apiClientId: string;
  /** Production client secret, or an empty string when unconfigured. */
  apiClientSecret: string;
  /** Preview client identifier, or an empty string when unconfigured. */
  previewApiClientId: string;
  /** Preview client secret, or an empty string when unconfigured. */
  previewApiClientSecret: string;
}

/** Token manager dependencies and refresh policy. */
export interface TokenManagerOptions {
  /** Cache implementation. Defaults to an owned {@link MemoryCache}. */
  cache?: TokenCache;
  /** Milliseconds before expiry at which a cached token is refreshed. */
  refreshBuffer?: number;
}

/**
 * A token endpoint miss for a request identified by custom domain.
 *
 * The class and stable `code` let callers classify the expected miss without
 * matching provider-controlled response text.
 */
export class MissingCustomDomainProjectError extends OAuthTokenRequestError {
  /** Stable machine-readable classification. */
  readonly code = "custom-domain-project-not-found" as const;

  /** Create a typed expected miss from a structured token response. */
  constructor(status: 400 | 404) {
    super(status, undefined, "project-not-found-for-domain");
    this.name = "MissingCustomDomainProjectError";
  }
}

function requireConfigText(name: string, value: unknown, maximum: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    throw new TypeError(`${name} must be a non-empty string of at most ${maximum} characters`);
  }
  return value;
}

function requireConfigString(name: string, value: unknown, maximum: number): string {
  if (typeof value !== "string" || value.length > maximum) {
    throw new TypeError(`${name} must be a string of at most ${maximum} characters`);
  }
  return value;
}

function copyConfig(config: OAuthConfig): OAuthConfig {
  if (typeof config !== "object" || config === null) {
    throw new TypeError("OAuth config must be an object");
  }
  return Object.freeze({
    apiBaseUrl: requireConfigText(
      "apiBaseUrl",
      config.apiBaseUrl,
      MAX_API_BASE_URL_LENGTH,
    ),
    apiClientId: requireConfigString(
      "apiClientId",
      config.apiClientId,
      MAX_CONFIG_VALUE_LENGTH,
    ),
    apiClientSecret: requireConfigString(
      "apiClientSecret",
      config.apiClientSecret,
      MAX_CONFIG_VALUE_LENGTH,
    ),
    previewApiClientId: requireConfigString(
      "previewApiClientId",
      config.previewApiClientId,
      MAX_CONFIG_VALUE_LENGTH,
    ),
    previewApiClientSecret: requireConfigString(
      "previewApiClientSecret",
      config.previewApiClientSecret,
      MAX_CONFIG_VALUE_LENGTH,
    ),
  });
}

function requireRefreshBuffer(value: number | undefined): number {
  const refreshBuffer = value ?? DEFAULT_REFRESH_BUFFER_MS;
  if (
    !Number.isSafeInteger(refreshBuffer) || refreshBuffer < 0 ||
    refreshBuffer > MAX_REFRESH_BUFFER_MS
  ) {
    throw new RangeError(
      `refreshBuffer must be an integer between 0 and ${MAX_REFRESH_BUFFER_MS}`,
    );
  }
  return refreshBuffer;
}

function requireScope(value: unknown): TokenScope {
  if (value !== "preview" && value !== "production") {
    throw new TypeError('scope must be "preview" or "production"');
  }
  return value;
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function optionalIdentity(name: string, value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" || value.length === 0 || value.trim().length === 0 ||
    value.length > MAX_TOKEN_IDENTITY_LENGTH || containsControlCharacter(value)
  ) {
    throw new TypeError(
      `${name} must be a non-empty value of at most ${MAX_TOKEN_IDENTITY_LENGTH} characters`,
    );
  }
  return value;
}

function isCustomDomainMissStatus(status: number): status is 400 | 404 {
  return status === 400 || status === 404;
}

function snapshotCachedEntry(
  value: unknown,
  scope: TokenScope,
  expectedIdentity: string | undefined,
): TokenCacheEntry | null {
  if (typeof value !== "object" || value === null) return null;
  try {
    const entry = value as Partial<TokenCacheEntry>;
    const token = entry.token;
    const expiresAt = entry.expiresAt;
    const entryScope = entry.scope;
    const projectSlug = entry.projectSlug;
    if (
      typeof token !== "string" || token.length === 0 ||
      token.length > MAX_CONFIG_VALUE_LENGTH || /\s/u.test(token) ||
      !Number.isSafeInteger(expiresAt) || (expiresAt as number) < 0 ||
      entryScope !== scope || projectSlug !== expectedIdentity
    ) {
      return null;
    }
    return {
      token,
      expiresAt: expiresAt as number,
      scope,
      ...(projectSlug === undefined ? {} : { projectSlug }),
    };
  } catch {
    return null;
  }
}

/** Caches and deduplicates OAuth service-token requests. */
export class TokenManager {
  private readonly config: OAuthConfig;
  private readonly cache: TokenCache;
  private readonly pendingRequests = new Map<string, PendingTokenRequest>();
  private readonly negativeCache = new Map<string, NegativeCacheEntry>();
  private readonly invalidations = new Map<string, Promise<void>>();
  private readonly refreshBuffer: number;
  private clearPromise: Promise<void> | null = null;
  private closePromise: Promise<void> | null = null;
  private closed = false;

  /** Create a token manager and snapshot its configuration. */
  constructor(config: OAuthConfig, options: TokenManagerOptions = {}) {
    this.config = copyConfig(config);
    this.refreshBuffer = requireRefreshBuffer(options.refreshBuffer);
    this.cache = options.cache ?? new MemoryCache();
  }

  /** Return a valid token, sharing one cache lookup and fetch per identity. */
  async getToken(
    scope: TokenScope,
    projectSlug?: string,
    customDomain?: string,
  ): Promise<string> {
    this.assertOpen();
    scope = requireScope(scope);
    const projectIdentity = optionalIdentity("projectSlug", projectSlug);
    const domainIdentity = optionalIdentity("customDomain", customDomain);
    if (projectIdentity !== undefined && domainIdentity !== undefined) {
      throw new TypeError("projectSlug and customDomain are mutually exclusive");
    }
    const cacheKey = this.getCacheKey(scope, projectIdentity, domainIdentity);

    return withSpan(
      ProxySpanNames.PROXY_TOKEN_FETCH,
      async () => {
        const lifecycleBarriers = this.getLifecycleBarriers(cacheKey);
        const existing = this.pendingRequests.get(cacheKey);
        if (
          existing &&
          (lifecycleBarriers.length === 0 ||
            this.sameLifecycleBarriers(existing.lifecycleBarriers, lifecycleBarriers))
        ) {
          return existing.promise;
        }

        const tokenPromise = this.resolveTokenAfterBarrier(
          cacheKey,
          scope,
          projectIdentity,
          domainIdentity,
          lifecycleBarriers,
        );
        this.pendingRequests.set(cacheKey, {
          promise: tokenPromise,
          lifecycleBarriers,
        });

        try {
          return await tokenPromise;
        } finally {
          if (this.pendingRequests.get(cacheKey)?.promise === tokenPromise) {
            this.pendingRequests.delete(cacheKey);
          }
        }
      },
      {
        "proxy.token_scope": scope,
        "proxy.has_project_slug": projectIdentity !== undefined,
        "proxy.has_custom_domain": domainIdentity !== undefined,
      },
    );
  }

  /** Register first, then wait for lifecycle work before resolving the token. */
  private async resolveTokenAfterBarrier(
    cacheKey: string,
    scope: TokenScope,
    projectSlug: string | undefined,
    customDomain: string | undefined,
    lifecycleBarriers: readonly Promise<void>[],
  ): Promise<string> {
    if (lifecycleBarriers.length > 0) await Promise.all(lifecycleBarriers);
    return this.resolveToken(cacheKey, scope, projectSlug, customDomain);
  }

  /** Resolve negative cache, positive cache, and network fetch in order. */
  private async resolveToken(
    cacheKey: string,
    scope: TokenScope,
    projectSlug: string | undefined,
    customDomain: string | undefined,
  ): Promise<string> {
    const negativeEntry = this.negativeCache.get(cacheKey);
    if (negativeEntry) {
      if (Date.now() - negativeEntry.cachedAt < NEGATIVE_CACHE_TTL_MS) {
        throw this.negativeCacheError(negativeEntry);
      }
      this.negativeCache.delete(cacheKey);
    }

    const cached = await this.cache.get(cacheKey);
    if (cached) {
      const ownedEntry = snapshotCachedEntry(cached, scope, projectSlug ?? customDomain);
      if (ownedEntry && this.isTokenValid(ownedEntry)) return ownedEntry.token;
      if (!ownedEntry) await this.cache.delete(cacheKey);
    }
    return this.fetchAndCacheToken(cacheKey, scope, projectSlug, customDomain);
  }

  /** Invalidate global tokens or both supported identity forms for a legacy project key. */
  async invalidateToken(scope: TokenScope, projectKey?: string): Promise<void> {
    this.assertOpen();
    scope = requireScope(scope);
    const identity = optionalIdentity("projectKey", projectKey);
    const cacheKeys = identity === undefined ? [this.getCacheKey(scope)] : [
      this.getCacheKey(scope, identity),
      this.getCacheKey(scope, undefined, identity),
    ];
    const blockers = this.getInvalidationBlockers(cacheKeys);
    const task = Promise.resolve().then(() => this.performInvalidation(cacheKeys, blockers));
    for (const cacheKey of cacheKeys) this.invalidations.set(cacheKey, task);
    try {
      await task;
    } finally {
      for (const cacheKey of cacheKeys) {
        if (this.invalidations.get(cacheKey) === task) this.invalidations.delete(cacheKey);
      }
    }
  }

  /** Wait for matching requests before deleting their cache keys. */
  private async performInvalidation(
    cacheKeys: string[],
    blockers: readonly Promise<unknown>[],
  ): Promise<void> {
    if (blockers.length > 0) await Promise.allSettled(blockers);
    for (const cacheKey of cacheKeys) {
      this.negativeCache.delete(cacheKey);
      await this.cache.delete(cacheKey);
    }
  }

  /** Clear every cached token after all already-started token requests settle. */
  async clearCache(): Promise<void> {
    this.assertOpen();
    if (this.clearPromise) return this.clearPromise;
    const blockers = this.getAllLifecycleWork();
    const task = Promise.resolve().then(() => this.performClear(blockers));
    this.clearPromise = task;
    try {
      await task;
    } finally {
      if (this.clearPromise === task) this.clearPromise = null;
    }
  }

  /** Wait for active lifecycle work and clear the underlying cache. */
  private async performClear(blockers: readonly Promise<unknown>[]): Promise<void> {
    if (blockers.length > 0) await Promise.allSettled(blockers);
    this.negativeCache.clear();
    await this.cache.clear();
  }

  /** Return the underlying cache statistics. */
  getStats(): Promise<CacheStats> {
    this.assertOpen();
    return this.cache.stats();
  }

  /** Wait for active requests and release the underlying cache exactly once. */
  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    const blockers = this.getAllLifecycleWork();
    this.closePromise = Promise.resolve().then(() => this.performClose(blockers));
    return this.closePromise;
  }

  /** Drain active operations before closing the underlying cache. */
  private async performClose(blockers: readonly Promise<unknown>[]): Promise<void> {
    if (blockers.length > 0) await Promise.allSettled(blockers);
    this.negativeCache.clear();
    await this.cache.close();
  }

  /** Reject operations after lifecycle shutdown. */
  private assertOpen(): void {
    if (this.closed) throw new Error("TokenManager is closed");
  }

  /** Snapshot lifecycle work that precedes a new request for this key. */
  private getLifecycleBarriers(cacheKey: string): Promise<void>[] {
    const barriers: Promise<void>[] = [];
    if (this.clearPromise) barriers.push(this.clearPromise);
    const invalidation = this.invalidations.get(cacheKey);
    if (invalidation && !barriers.includes(invalidation)) barriers.push(invalidation);
    return barriers;
  }

  /** Return whether two requests wait for the same lifecycle generation. */
  private sameLifecycleBarriers(
    left: readonly Promise<void>[],
    right: readonly Promise<void>[],
  ): boolean {
    return left.length === right.length && left.every((barrier, index) => barrier === right[index]);
  }

  /** Snapshot work that an invalidation must follow without observing later requests. */
  private getInvalidationBlockers(cacheKeys: readonly string[]): Promise<unknown>[] {
    const blockers = new Set<Promise<unknown>>();
    if (this.clearPromise) blockers.add(this.clearPromise);
    for (const cacheKey of cacheKeys) {
      const invalidation = this.invalidations.get(cacheKey);
      if (invalidation) blockers.add(invalidation);
      const request = this.pendingRequests.get(cacheKey);
      if (request) blockers.add(request.promise);
    }
    return [...blockers];
  }

  /** Snapshot all work that a clear or close must drain. */
  private getAllLifecycleWork(): Promise<unknown>[] {
    const blockers = new Set<Promise<unknown>>();
    if (this.clearPromise) blockers.add(this.clearPromise);
    for (const invalidation of this.invalidations.values()) blockers.add(invalidation);
    for (const request of this.pendingRequests.values()) blockers.add(request.promise);
    return [...blockers];
  }

  /** Build an unambiguous bounded cache key for one identity form. */
  private getCacheKey(
    scope: TokenScope,
    projectSlug?: string,
    customDomain?: string,
  ): string {
    if (projectSlug !== undefined) return `${scope}:project:${projectSlug}`;
    if (customDomain !== undefined) return `${scope}:domain:${customDomain}`;
    return `${scope}:global`;
  }

  /** Return whether a cached token remains outside the refresh window. */
  private isTokenValid(cached: TokenCacheEntry): boolean {
    return Date.now() + this.refreshBuffer < cached.expiresAt;
  }

  /** Recreate the typed error represented by a negative-cache entry. */
  private negativeCacheError(entry: NegativeCacheEntry): OAuthTokenRequestError {
    if (entry.kind === "missing-custom-domain-project") {
      return new MissingCustomDomainProjectError(entry.status as 400 | 404);
    }
    return new OAuthTokenRequestError(entry.status, entry.responseText);
  }

  /** Store a bounded, sanitized negative-cache entry. */
  private cacheNegativeFailure(
    cacheKey: string,
    error: OAuthTokenRequestError,
    kind: NegativeCacheKind,
  ): void {
    const now = Date.now();
    for (const [key, entry] of this.negativeCache) {
      if (now - entry.cachedAt >= NEGATIVE_CACHE_TTL_MS) this.negativeCache.delete(key);
    }
    if (!this.negativeCache.has(cacheKey) && this.negativeCache.size >= NEGATIVE_CACHE_MAX_SIZE) {
      const oldest = this.negativeCache.keys().next().value;
      if (oldest !== undefined) this.negativeCache.delete(oldest);
    }
    this.negativeCache.set(cacheKey, {
      status: error.status,
      responseText: error.responseText,
      cachedAt: now,
      kind,
    });
  }

  /** Mint and cache one token. */
  private async fetchAndCacheToken(
    cacheKey: string,
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
      if (error instanceof OAuthTokenRequestError && isCustomDomainMissStatus(error.status)) {
        const missingCustomDomainProject = customDomain !== undefined ||
          error.reason === "project-not-found-for-domain";
        const kind: NegativeCacheKind = missingCustomDomainProject
          ? "missing-custom-domain-project"
          : "oauth-request";
        this.cacheNegativeFailure(cacheKey, error, kind);
        if (kind === "missing-custom-domain-project") {
          throw new MissingCustomDomainProjectError(error.status);
        }
      }
      throw error;
    }

    const expiresAt = this.calculateExpiresAt(response);
    await this.cache.set(cacheKey, {
      token: response.access_token,
      expiresAt,
      scope,
      ...(projectSlug === undefined && customDomain === undefined
        ? {}
        : { projectSlug: projectSlug ?? customDomain }),
    });

    return response.access_token;
  }

  /** Derive a safe absolute expiry from response TTL or JWT metadata. */
  private calculateExpiresAt(response: TokenResponse): number {
    if (response.expires_in !== undefined) {
      const expiresAt = Date.now() + response.expires_in * 1_000;
      if (!Number.isSafeInteger(expiresAt)) {
        throw new TypeError("Invalid OAuth token response: expiry is outside the supported range");
      }
      return expiresAt;
    }

    const encodedPayload = response.access_token.split(".")[1];
    if (!encodedPayload) return Date.now() + DEFAULT_TOKEN_TTL_MS;

    let decoded: unknown;
    try {
      const base64 = encodedPayload.replace(/-/g, "+").replace(/_/g, "/");
      const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
      decoded = JSON.parse(atob(padded));
    } catch {
      // A token need not be a JWT. Use the documented default TTL when it is not.
      return Date.now() + DEFAULT_TOKEN_TTL_MS;
    }

    if (typeof decoded === "object" && decoded !== null && "exp" in decoded) {
      const exp = (decoded as { exp?: unknown }).exp;
      if (typeof exp !== "number" || !Number.isSafeInteger(exp) || exp <= 0) {
        throw new TypeError("Invalid OAuth token response: JWT expiry is invalid");
      }
      const expiresAt = exp * 1_000;
      if (!Number.isSafeInteger(expiresAt)) {
        throw new TypeError("Invalid OAuth token response: expiry is outside the supported range");
      }
      if (expiresAt <= Date.now()) {
        throw new TypeError("Invalid OAuth token response: JWT is already expired");
      }
      return expiresAt;
    }

    return Date.now() + DEFAULT_TOKEN_TTL_MS;
  }
}
