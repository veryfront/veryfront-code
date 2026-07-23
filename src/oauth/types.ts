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
  redirectUri?: string;
  scopes?: string[];
  createdAt: number;
  metadata?: Record<string, unknown>;
}

/**
 * TokenStore is keyed by `(serviceId, userId)`. Tokens are per-user.
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
  /** Persist a new OAuth state row for the initiating user. */
  setState(state: string, meta: StoredOAuthState): Promise<void>;
  /** Atomically read and delete state. Returns null if unknown/expired. */
  consumeState(state: string): Promise<StoredOAuthState | null>;
}
