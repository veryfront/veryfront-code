// Re-export schema-based types
export type {
  AuthorizationUrlOptions,
  OAuthProviderConfig,
  OAuthServiceConfig,
  OAuthState,
  OAuthTokens,
  TokenExchangeOptions,
  TokenExchangeResult,
} from "./schemas/index.ts";

// Import types used locally in this file
import type { OAuthTokens } from "./schemas/index.ts";

/**
 * Persisted OAuth state row. Created when init handler starts a flow and
 * consumed exactly once by the callback handler.
 *
 * `userId` binds the flow to the authenticated user who initiated it so the
 * resulting tokens are stored in that user's slot (not a shared one).
 */
export interface StoredOAuthState {
  userId: string;
  serviceId: string;
  codeVerifier?: string;
  /**
   * Transaction redirect binding. Optional for source compatibility with
   * legacy stores; current handlers reject consumed rows that omit it.
   */
  redirectUri?: string;
  /**
   * Requested scope snapshot. Optional for source compatibility with legacy
   * stores; current handlers reject consumed rows that omit it.
   */
  scopes?: string[];
  createdAt: number;
  metadata?: Record<string, unknown>;
}

/**
 * Detached token row plus an opaque store revision.
 *
 * Revisions identify a specific write, not token value equality. A store must
 * issue a new revision for every successful `setTokens` write so disconnect +
 * reauthorization cannot recreate an older generation (the ABA problem).
 */
export interface OAuthTokenSnapshot {
  tokens: OAuthTokens;
  revision: string;
}

/**
 * TokenStore is keyed by `(serviceId, userId)` — tokens are per-user.
 *
 * Using a single-slot-per-service store is a vulnerability: the last OAuth
 * completion overwrites all others, so an attacker who starts and finishes
 * an OAuth flow with their own account can cause server-side code to act
 * on the attacker's account. Callers MUST pass `userId` from authenticated
 * session context.
 */
export interface TokenStore {
  getTokens(serviceId: string, userId: string): Promise<OAuthTokens | null>;
  setTokens(serviceId: string, userId: string, tokens: OAuthTokens): Promise<void>;
  clearTokens(serviceId: string, userId: string): Promise<void>;
  /**
   * Read tokens together with the opaque revision for that exact write.
   *
   * This optional capability is required for automatic token refresh. It is
   * optional on the interface so existing stores remain source-compatible,
   * but refresh fails closed before contacting the provider when either
   * revision method is absent.
   */
  getTokenSnapshot?(
    serviceId: string,
    userId: string,
  ): Promise<OAuthTokenSnapshot | null>;
  /**
   * Atomically replace a token row only when its current revision equals
   * `expectedRevision`. The comparison and write MUST be one indivisible
   * backing-store operation. Return false when the row is absent or changed.
   * Every successful replacement MUST receive a fresh revision.
   */
  compareAndSetTokens?(
    serviceId: string,
    userId: string,
    expectedRevision: string,
    tokens: OAuthTokens,
  ): Promise<boolean>;
  /**
   * Run an operation while holding a refresh lock for one token slot.
   *
   * Production stores shared by multiple workers MUST implement this as a
   * distributed, bounded, crash-recoverable lease (including safe release and
   * renewal for the operation lifetime). A process-local mutex is insufficient
   * for a shared backing store. Automatic refresh fails closed when absent.
   */
  withTokenRefreshLock?<T>(
    serviceId: string,
    userId: string,
    operation: () => Promise<T>,
  ): Promise<T>;
  /** Persist a new OAuth state row for the initiating user. */
  setState(state: string, meta: StoredOAuthState): Promise<void>;
  /** Atomically read and delete state. Returns null if unknown/expired. */
  consumeState(state: string): Promise<StoredOAuthState | null>;
}

/**
 * Token store contract required for safe refresh across concurrent workers.
 *
 * `TokenStore` remains the source-compatible base contract for non-refreshing
 * use cases. Production services that may persist refresh tokens should accept
 * or implement this stricter capability type.
 */
export interface RefreshCapableTokenStore extends TokenStore {
  getTokenSnapshot(serviceId: string, userId: string): Promise<OAuthTokenSnapshot | null>;
  compareAndSetTokens(
    serviceId: string,
    userId: string,
    expectedRevision: string,
    tokens: OAuthTokens,
  ): Promise<boolean>;
  withTokenRefreshLock<T>(
    serviceId: string,
    userId: string,
    operation: () => Promise<T>,
  ): Promise<T>;
}
