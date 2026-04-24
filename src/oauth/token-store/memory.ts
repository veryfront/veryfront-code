import type { OAuthTokens, StoredOAuthState, TokenStore } from "../types.ts";

/** State expiry window: reject any state older than this (10 minutes). */
const STATE_EXPIRY_MS = 10 * 60 * 1_000;

/**
 * In-memory TokenStore keyed by `(serviceId, userId)`.
 *
 * Suitable for development and tests. For production use a persistent store
 * (Redis, Postgres, ...) keyed the same way. Never share a single slot per
 * service across users — see VULN-AUTH-2.
 */
export class MemoryTokenStore implements TokenStore {
  private tokens = new Map<string, OAuthTokens>();
  private states = new Map<string, StoredOAuthState>();
  private projectId: string;

  constructor(projectId = "default") {
    this.projectId = projectId;
  }

  private scopedKey(serviceId: string, userId: string): string {
    return `${this.projectId}:${serviceId}:${userId}`;
  }

  getTokens(serviceId: string, userId: string): Promise<OAuthTokens | null> {
    return Promise.resolve(this.tokens.get(this.scopedKey(serviceId, userId)) ?? null);
  }

  setTokens(serviceId: string, userId: string, tokens: OAuthTokens): Promise<void> {
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
    const tokens = this.tokens.get(this.scopedKey(serviceId, userId));
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
