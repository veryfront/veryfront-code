import { logger as baseLogger } from "#veryfront/utils";
import { isProduction } from "#veryfront/platform/environment.ts";
import { LRUCacheAdapter } from "#veryfront/utils/cache/stores/memory/lru-cache-adapter.ts";
import type { OAuthTokens, StoredOAuthState, TokenStore } from "../types.ts";

const logger = baseLogger.component("o-auth");

/** State expiry window: reject any state older than this (10 minutes). */
const STATE_EXPIRY_MS = 10 * 60 * 1_000;

/**
 * Default cap on stored token slots. Bounds memory in long-lived processes;
 * past this, the least-recently-used `(serviceId, userId)` slot is evicted
 * (the affected user simply re-authenticates). Tokens are NOT given a TTL —
 * an expired access token may still be refreshable via its refresh token, so
 * eviction is by capacity/recency only.
 */
const DEFAULT_MAX_TOKEN_ENTRIES = 10_000;

/** Options for {@link MemoryTokenStore}. */
export interface MemoryTokenStoreOptions {
  /**
   * Maximum number of `(serviceId, userId)` token slots to retain before
   * least-recently-used eviction kicks in. Defaults to
   * {@link DEFAULT_MAX_TOKEN_ENTRIES}.
   */
  maxEntries?: number;
}

/**
 * In-memory TokenStore keyed by `(serviceId, userId)`.
 *
 * Suitable for development and tests ONLY. It is process-local and not
 * durable: tokens are lost on restart and not shared across instances or
 * workers, and the exported {@link memoryTokenStore} singleton shares one
 * keyspace process-wide. For production inject a persistent, scoped store
 * (Redis, Postgres, ...) keyed the same way.
 *
 * The token map is bounded (see {@link MemoryTokenStoreOptions.maxEntries}) so
 * it cannot grow without limit. Never share a single slot per service across
 * users — see VULN-AUTH-2.
 */
export class MemoryTokenStore implements TokenStore {
  private tokens: LRUCacheAdapter;
  private states = new Map<string, StoredOAuthState>();
  private projectId: string;
  private warnedProductionUse = false;

  constructor(projectId = "default", options: MemoryTokenStoreOptions = {}) {
    this.projectId = projectId;
    this.tokens = new LRUCacheAdapter({
      maxEntries: options.maxEntries ?? DEFAULT_MAX_TOKEN_ENTRIES,
    });
  }

  private scopedKey(serviceId: string, userId: string): string {
    return `${this.projectId}:${serviceId}:${userId}`;
  }

  /**
   * Warn once if this non-durable store is used to persist tokens in
   * production — almost always a misconfiguration (a persistent TokenStore
   * should have been injected).
   */
  private warnIfProductionUse(): void {
    if (this.warnedProductionUse || !isProduction()) return;
    this.warnedProductionUse = true;
    logger.warn(
      "MemoryTokenStore is persisting OAuth tokens in production. It is " +
        "process-local and not durable (tokens are lost on restart and not " +
        "shared across instances). Inject a persistent, scoped TokenStore " +
        "(Redis/Postgres/...) instead.",
    );
  }

  getTokens(serviceId: string, userId: string): Promise<OAuthTokens | null> {
    return Promise.resolve(
      this.tokens.get<OAuthTokens>(this.scopedKey(serviceId, userId)) ?? null,
    );
  }

  setTokens(serviceId: string, userId: string, tokens: OAuthTokens): Promise<void> {
    this.warnIfProductionUse();
    this.tokens.set(this.scopedKey(serviceId, userId), tokens);
    return Promise.resolve();
  }

  clearTokens(serviceId: string, userId: string): Promise<void> {
    this.tokens.delete(this.scopedKey(serviceId, userId));
    return Promise.resolve();
  }

  setState(state: string, meta: StoredOAuthState): Promise<void> {
    this.states.set(state, meta);
    this.cleanupExpiredStates();
    return Promise.resolve();
  }

  /**
   * Atomically read and delete state (one-shot). Returns null for unknown or
   * expired entries. Expired entries are removed on read.
   */
  consumeState(state: string): Promise<StoredOAuthState | null> {
    const meta = this.states.get(state);
    if (!meta) return Promise.resolve(null);
    this.states.delete(state);
    if (Date.now() - meta.createdAt > STATE_EXPIRY_MS) {
      return Promise.resolve(null);
    }
    return Promise.resolve(meta);
  }

  private cleanupExpiredStates(): void {
    const now = Date.now();
    for (const [state, meta] of this.states) {
      if (now - meta.createdAt > STATE_EXPIRY_MS) {
        this.states.delete(state);
      }
    }
  }

  /** List connected slots as `${serviceId}:${userId}` strings (test/debug aid). */
  getConnectedServices(): string[] {
    const prefix = `${this.projectId}:`;
    return [...this.tokens.keys()].map((key) =>
      key.startsWith(prefix) ? key.slice(prefix.length) : key
    );
  }

  /** Whether a given user has usable tokens for a service. */
  isConnected(serviceId: string, userId: string): boolean {
    const tokens = this.tokens.get<OAuthTokens>(this.scopedKey(serviceId, userId));
    if (!tokens) return false;

    const isExpired = tokens.expiresAt != null && Date.now() > tokens.expiresAt;
    return !isExpired || Boolean(tokens.refreshToken);
  }

  clearAll(): void {
    this.tokens.clear();
    this.states.clear();
  }
}

export const memoryTokenStore: TokenStore = new MemoryTokenStore();
