import { logger as baseLogger } from "#veryfront/utils";
import { isProduction } from "#veryfront/platform/environment.ts";
import { LRUCacheAdapter } from "#veryfront/utils/cache/stores/memory/lru-cache-adapter.ts";
import type { OAuthTokens, StoredOAuthState, TokenStore } from "../types.ts";
import {
  isJsonCompatible,
  OAUTH_MAX_TOKEN_LENGTH,
  OAUTH_MAX_TOKEN_METADATA_LENGTH,
  OAUTH_STATE_CLOCK_SKEW_MS,
  OAUTH_STATE_EXPIRY_MS,
} from "../validation.ts";

const logger = baseLogger.component("o-auth");

/**
 * Default cap on stored token slots. Bounds memory in long-lived processes;
 * past this, the least-recently-used `(serviceId, userId)` slot is evicted
 * (the affected user simply re-authenticates). Tokens are not given a TTL.
 * An expired access token may still be refreshable via its refresh token, so
 * eviction is by capacity/recency only.
 */
const DEFAULT_MAX_TOKEN_ENTRIES = 10_000;

/** Default cap on in-flight OAuth state values. */
const DEFAULT_MAX_STATE_ENTRIES = 10_000;

/** Hard ceiling shared with the underlying in-memory LRU implementation. */
const MAX_MEMORY_STORE_ENTRIES = 1_000_000;

const MAX_SCOPED_IDENTIFIER_LENGTH = 4_096;
const MAX_STATE_KEY_LENGTH = 4_096;
const MAX_STATE_METADATA_BYTES = 65_536;

function requirePositiveSafeInteger(value: number, name: string): number {
  if (
    !Number.isSafeInteger(value) || value <= 0 ||
    value > MAX_MEMORY_STORE_ENTRIES
  ) {
    throw new TypeError(
      `${name} must be a positive safe integer no greater than ${MAX_MEMORY_STORE_ENTRIES}`,
    );
  }
  return value;
}

function cloneTokens(tokens: OAuthTokens): OAuthTokens {
  const snapshot: OAuthTokens = { accessToken: tokens.accessToken };
  if (tokens.refreshToken !== undefined) snapshot.refreshToken = tokens.refreshToken;
  if (tokens.expiresAt !== undefined) snapshot.expiresAt = tokens.expiresAt;
  if (tokens.tokenType !== undefined) snapshot.tokenType = tokens.tokenType;
  if (tokens.scope !== undefined) snapshot.scope = tokens.scope;
  if (tokens.idToken !== undefined) snapshot.idToken = tokens.idToken;
  return snapshot;
}

function cloneState(state: StoredOAuthState): StoredOAuthState {
  return structuredClone(state);
}

function requireIdentifier(value: unknown, name: string, maximum: number): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maximum) {
    throw new TypeError(`${name} must contain between 1 and ${maximum} characters`);
  }
}

function validateTokens(tokens: OAuthTokens): void {
  requireIdentifier(tokens.accessToken, "accessToken", OAUTH_MAX_TOKEN_LENGTH);
  if (tokens.refreshToken !== undefined) {
    requireIdentifier(tokens.refreshToken, "refreshToken", OAUTH_MAX_TOKEN_LENGTH);
  }
  if (tokens.idToken !== undefined) {
    requireIdentifier(tokens.idToken, "idToken", OAUTH_MAX_TOKEN_LENGTH);
  }
  if (tokens.tokenType !== undefined) {
    requireIdentifier(tokens.tokenType, "tokenType", OAUTH_MAX_TOKEN_METADATA_LENGTH);
  }
  if (
    tokens.scope !== undefined &&
    (typeof tokens.scope !== "string" || tokens.scope.length > OAUTH_MAX_TOKEN_METADATA_LENGTH)
  ) {
    throw new TypeError(
      `scope must not exceed ${OAUTH_MAX_TOKEN_METADATA_LENGTH} characters`,
    );
  }
  if (
    tokens.expiresAt !== undefined &&
    (!Number.isSafeInteger(tokens.expiresAt) || tokens.expiresAt < 0)
  ) {
    throw new TypeError("expiresAt must be a non-negative safe integer");
  }
}

function validateState(state: string, meta: StoredOAuthState): void {
  requireIdentifier(state, "state", MAX_STATE_KEY_LENGTH);
  requireIdentifier(meta.userId, "state userId", MAX_SCOPED_IDENTIFIER_LENGTH);
  requireIdentifier(meta.serviceId, "state serviceId", MAX_SCOPED_IDENTIFIER_LENGTH);
  if (
    !Number.isSafeInteger(meta.createdAt) || meta.createdAt < 0 ||
    meta.createdAt > Date.now() + OAUTH_STATE_CLOCK_SKEW_MS
  ) {
    throw new TypeError("state createdAt must be a valid current timestamp");
  }

  if (meta.metadata !== undefined && !isJsonCompatible(meta.metadata)) {
    throw new TypeError("state metadata must contain only JSON-compatible values");
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(meta);
  } catch {
    throw new TypeError("state metadata must be JSON-serializable");
  }
  if (new TextEncoder().encode(serialized).byteLength > MAX_STATE_METADATA_BYTES) {
    throw new TypeError(`state metadata must not exceed ${MAX_STATE_METADATA_BYTES} bytes`);
  }
}

/** Options for {@link MemoryTokenStore}. */
export interface MemoryTokenStoreOptions {
  /**
   * Maximum number of `(serviceId, userId)` token slots to retain before
   * least-recently-used eviction kicks in. Defaults to
   * {@link DEFAULT_MAX_TOKEN_ENTRIES}.
   */
  maxEntries?: number;
  /**
   * Maximum number of in-flight OAuth state entries to retain before oldest
   * entries are evicted. Defaults to {@link DEFAULT_MAX_STATE_ENTRIES}.
   */
  maxStateEntries?: number;
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
 * users. See VULN-AUTH-2.
 */
export class MemoryTokenStore implements TokenStore {
  private tokens: LRUCacheAdapter;
  private states = new Map<string, StoredOAuthState>();
  private readonly maxStateEntries: number;
  private readonly projectId: string;
  private warnedProductionUse = false;

  constructor(projectId = "default", options: MemoryTokenStoreOptions = {}) {
    requireIdentifier(projectId, "projectId", MAX_SCOPED_IDENTIFIER_LENGTH);
    this.projectId = projectId;
    this.maxStateEntries = requirePositiveSafeInteger(
      options.maxStateEntries ?? DEFAULT_MAX_STATE_ENTRIES,
      "maxStateEntries",
    );
    this.tokens = new LRUCacheAdapter({
      maxEntries: options.maxEntries ?? DEFAULT_MAX_TOKEN_ENTRIES,
    });
  }

  private scopedKey(serviceId: string, userId: string): string {
    requireIdentifier(serviceId, "serviceId", MAX_SCOPED_IDENTIFIER_LENGTH);
    requireIdentifier(userId, "userId", MAX_SCOPED_IDENTIFIER_LENGTH);
    return JSON.stringify([this.projectId, serviceId, userId]);
  }

  /**
   * Warn once if this non-durable store is used to persist tokens in
   * production. This is almost always a misconfiguration (a persistent TokenStore
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

  async getTokens(serviceId: string, userId: string): Promise<OAuthTokens | null> {
    const tokens = this.tokens.get<OAuthTokens>(this.scopedKey(serviceId, userId));
    return tokens ? cloneTokens(tokens) : null;
  }

  async setTokens(serviceId: string, userId: string, tokens: OAuthTokens): Promise<void> {
    validateTokens(tokens);
    this.warnIfProductionUse();
    this.tokens.set(this.scopedKey(serviceId, userId), cloneTokens(tokens));
  }

  async clearTokens(serviceId: string, userId: string): Promise<void> {
    this.tokens.delete(this.scopedKey(serviceId, userId));
  }

  async setState(state: string, meta: StoredOAuthState): Promise<void> {
    validateState(state, meta);
    this.cleanupExpiredStates();
    this.states.set(state, cloneState(meta));
    this.evictOldestStates();
  }

  /**
   * Atomically read and delete state (one-shot). Returns null for unknown or
   * expired entries. Expired entries are removed on read.
   */
  async consumeState(state: string): Promise<StoredOAuthState | null> {
    if (state.length === 0 || state.length > MAX_STATE_KEY_LENGTH) return null;
    const meta = this.states.get(state);
    if (!meta) return null;
    this.states.delete(state);
    if (Date.now() - meta.createdAt > OAUTH_STATE_EXPIRY_MS) {
      return null;
    }
    return cloneState(meta);
  }

  private cleanupExpiredStates(): void {
    const now = Date.now();
    for (const [state, meta] of this.states) {
      if (now - meta.createdAt > OAUTH_STATE_EXPIRY_MS) {
        this.states.delete(state);
      }
    }
  }

  private evictOldestStates(): void {
    while (this.states.size > this.maxStateEntries) {
      const oldestState = this.states.keys().next().value;
      if (oldestState === undefined) return;
      this.states.delete(oldestState);
    }
  }

  /** List connected slots as `${serviceId}:${userId}` strings (test/debug aid). */
  getConnectedServices(): string[] {
    return [...this.tokens.keys()].map((key) => {
      try {
        const [projectId, serviceId, userId] = JSON.parse(key) as [string, string, string];
        if (projectId === this.projectId) return `${serviceId}:${userId}`;
      } catch {
        // Keys are produced only by scopedKey. Keep a defensive fallback so a
        // corrupted debug entry does not make inspection itself fail.
      }
      return key;
    });
  }

  /** Whether a given user has usable tokens for a service. */
  isConnected(serviceId: string, userId: string): boolean {
    const tokens = this.tokens.get<OAuthTokens>(this.scopedKey(serviceId, userId));
    if (!tokens) return false;

    const isExpired = tokens.expiresAt != null && Date.now() >= tokens.expiresAt;
    return !isExpired || Boolean(tokens.refreshToken);
  }

  clearAll(): void {
    this.tokens.clear();
    this.states.clear();
  }
}

export const memoryTokenStore: TokenStore = new MemoryTokenStore();
