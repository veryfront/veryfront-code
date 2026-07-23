import { logger as baseLogger } from "#veryfront/utils";
import { isProduction } from "#veryfront/platform/environment.ts";
import { LRUCacheAdapter } from "#veryfront/utils/cache/stores/memory/lru-cache-adapter.ts";
import type {
  OAuthTokens,
  OAuthTokenSnapshot,
  RefreshCapableTokenStore,
  StoredOAuthState,
} from "../types.ts";
import {
  cloneStoredOAuthState,
  DEFAULT_OAUTH_STATE_CLOCK_SKEW_MS,
  DEFAULT_OAUTH_STATE_TTL_MS,
  isFreshOAuthStateTimestamp,
  MAX_OAUTH_STATE_KEY_LENGTH,
  normalizeStoredOAuthStateForStorage,
} from "../state-utils.ts";
import { normalizeStoredOAuthTokens } from "../token-utils.ts";
import {
  MAX_OAUTH_PROJECT_ID_LENGTH,
  MAX_OAUTH_SERVICE_ID_LENGTH,
  MAX_OAUTH_USER_ID_LENGTH,
} from "../limits.ts";

const logger = baseLogger.component("o-auth");

/**
 * Default cap on stored token slots. Bounds memory in long-lived processes;
 * past this, the least-recently-used `(serviceId, userId)` slot is evicted
 * (the affected user simply re-authenticates). Tokens are NOT given a TTL —
 * an expired access token may still be refreshable via its refresh token, so
 * eviction is by capacity/recency only.
 */
const DEFAULT_MAX_TOKEN_ENTRIES = 10_000;

/** Default cap on in-flight OAuth state values. */
const DEFAULT_MAX_STATE_ENTRIES = 10_000;

interface VersionedTokenEntry {
  revision: string;
  tokens: OAuthTokens;
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
  /**
   * Maximum age for an OAuth state row. Defaults to 10 minutes and cannot
   * exceed the callback handler's 10-minute acceptance window.
   */
  stateTtlMs?: number;
}

function requirePositiveSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function requireTrimmedIdentifier(value: string, name: string, maxLength: number): string {
  if (!value || value.trim() !== value || value.length > maxLength) {
    throw new RangeError(`${name} must be trimmed, nonblank, and at most ${maxLength} characters`);
  }
  return value;
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
export class MemoryTokenStore implements RefreshCapableTokenStore {
  private tokens: LRUCacheAdapter;
  private states = new Map<string, StoredOAuthState>();
  private readonly maxStateEntries: number;
  private readonly stateTtlMs: number;
  private readonly projectId: string;
  private warnedProductionUse = false;
  private nextTokenRevision = 0n;
  private readonly refreshLockTails = new Map<string, Promise<void>>();

  constructor(projectId = "default", options: MemoryTokenStoreOptions = {}) {
    this.projectId = requireTrimmedIdentifier(
      projectId,
      "projectId",
      MAX_OAUTH_PROJECT_ID_LENGTH,
    );
    this.maxStateEntries = requirePositiveSafeInteger(
      options.maxStateEntries ?? DEFAULT_MAX_STATE_ENTRIES,
      "maxStateEntries",
    );
    this.stateTtlMs = requirePositiveSafeInteger(
      options.stateTtlMs ?? DEFAULT_OAUTH_STATE_TTL_MS,
      "stateTtlMs",
    );
    if (this.stateTtlMs > DEFAULT_OAUTH_STATE_TTL_MS) {
      throw new RangeError(`stateTtlMs must not exceed ${DEFAULT_OAUTH_STATE_TTL_MS}`);
    }
    const maxEntries = requirePositiveSafeInteger(
      options.maxEntries ?? DEFAULT_MAX_TOKEN_ENTRIES,
      "maxEntries",
    );
    this.tokens = new LRUCacheAdapter({
      maxEntries,
    });
  }

  private scopedKey(serviceId: string, userId: string): string {
    requireTrimmedIdentifier(serviceId, "serviceId", MAX_OAUTH_SERVICE_ID_LENGTH);
    requireTrimmedIdentifier(userId, "userId", MAX_OAUTH_USER_ID_LENGTH);
    return JSON.stringify([this.projectId, serviceId, userId]);
  }

  private createTokenRevision(): string {
    this.nextTokenRevision += 1n;
    return this.nextTokenRevision.toString(36);
  }

  private readTokenEntry(serviceId: string, userId: string): VersionedTokenEntry | null {
    const entry = this.tokens.get<VersionedTokenEntry>(this.scopedKey(serviceId, userId));
    if (!entry) return null;
    if (typeof entry.revision !== "string" || !entry.revision) {
      throw new Error("MemoryTokenStore contains an invalid token revision");
    }
    const tokens = normalizeStoredOAuthTokens(entry.tokens);
    if (!tokens) throw new Error("MemoryTokenStore contains an invalid token row");
    return { revision: entry.revision, tokens };
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

  async getTokens(serviceId: string, userId: string): Promise<OAuthTokens | null> {
    return this.readTokenEntry(serviceId, userId)?.tokens ?? null;
  }

  async getTokenSnapshot(serviceId: string, userId: string): Promise<OAuthTokenSnapshot | null> {
    return this.readTokenEntry(serviceId, userId);
  }

  async setTokens(serviceId: string, userId: string, tokens: OAuthTokens): Promise<void> {
    const snapshot = normalizeStoredOAuthTokens(tokens);
    if (!snapshot) throw new TypeError("Invalid OAuth token row");
    this.warnIfProductionUse();
    this.tokens.set(
      this.scopedKey(serviceId, userId),
      {
        revision: this.createTokenRevision(),
        tokens: snapshot,
      } satisfies VersionedTokenEntry,
    );
  }

  async compareAndSetTokens(
    serviceId: string,
    userId: string,
    expectedRevision: string,
    tokens: OAuthTokens,
  ): Promise<boolean> {
    if (!expectedRevision) {
      throw new TypeError("Expected OAuth token revision must not be empty");
    }
    const replacement = normalizeStoredOAuthTokens(tokens);
    if (!replacement) throw new TypeError("Invalid OAuth token row");

    // No await occurs between the comparison and write. JavaScript execution
    // within one MemoryTokenStore instance is therefore indivisible here.
    const current = this.readTokenEntry(serviceId, userId);
    if (!current || current.revision !== expectedRevision) return false;
    this.warnIfProductionUse();
    this.tokens.set(
      this.scopedKey(serviceId, userId),
      {
        revision: this.createTokenRevision(),
        tokens: replacement,
      } satisfies VersionedTokenEntry,
    );
    return true;
  }

  async withTokenRefreshLock<T>(
    serviceId: string,
    userId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const key = this.scopedKey(serviceId, userId);
    const prior = this.refreshLockTails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = prior.catch(() => undefined).then(() => current);
    this.refreshLockTails.set(key, tail);

    await prior.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (this.refreshLockTails.get(key) === tail) this.refreshLockTails.delete(key);
    }
  }

  async clearTokens(serviceId: string, userId: string): Promise<void> {
    this.tokens.delete(this.scopedKey(serviceId, userId));
  }

  async setState(state: string, meta: StoredOAuthState): Promise<void> {
    if (!state || state.length > MAX_OAUTH_STATE_KEY_LENGTH) {
      throw new RangeError(
        `state must contain between 1 and ${MAX_OAUTH_STATE_KEY_LENGTH} characters`,
      );
    }
    const snapshot = normalizeStoredOAuthStateForStorage(
      meta,
      Date.now(),
      this.stateTtlMs,
      DEFAULT_OAUTH_STATE_CLOCK_SKEW_MS,
    );
    if (!snapshot) throw new TypeError("Invalid OAuth state row");
    this.cleanupExpiredStates();
    if (this.states.has(state)) throw new Error("OAuth state already exists");
    this.states.set(state, snapshot);
    this.evictOldestStates();
  }

  /**
   * Atomically read and delete state (one-shot). Returns null for unknown or
   * expired entries. Expired entries are removed on read.
   */
  async consumeState(state: string): Promise<StoredOAuthState | null> {
    const meta = this.states.get(state);
    if (!meta) return null;
    this.states.delete(state);
    if (
      !isFreshOAuthStateTimestamp(
        meta.createdAt,
        Date.now(),
        this.stateTtlMs,
        DEFAULT_OAUTH_STATE_CLOCK_SKEW_MS,
      )
    ) {
      return null;
    }
    return cloneStoredOAuthState(meta);
  }

  private cleanupExpiredStates(): void {
    const now = Date.now();
    for (const [state, meta] of this.states) {
      if (
        !isFreshOAuthStateTimestamp(
          meta.createdAt,
          now,
          this.stateTtlMs,
          DEFAULT_OAUTH_STATE_CLOCK_SKEW_MS,
        )
      ) {
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
    const connected: string[] = [];
    for (const key of this.tokens.keys()) {
      const tuple = JSON.parse(key) as unknown;
      if (
        !Array.isArray(tuple) || tuple.length !== 3 || tuple[0] !== this.projectId ||
        typeof tuple[1] !== "string" || typeof tuple[2] !== "string"
      ) {
        throw new Error("MemoryTokenStore contains an invalid scoped key");
      }
      connected.push(`${encodeURIComponent(tuple[1])}:${encodeURIComponent(tuple[2])}`);
    }
    return connected;
  }

  /** Whether a given user has usable tokens for a service. */
  isConnected(serviceId: string, userId: string): boolean {
    const snapshot = this.readTokenEntry(serviceId, userId)?.tokens;
    if (!snapshot) return false;

    const isExpired = snapshot.expiresAt != null && Date.now() >= snapshot.expiresAt;
    return !isExpired || Boolean(snapshot.refreshToken);
  }

  clearAll(): void {
    this.tokens.clear();
    this.states.clear();
  }
}

export const memoryTokenStore: RefreshCapableTokenStore = new MemoryTokenStore();
