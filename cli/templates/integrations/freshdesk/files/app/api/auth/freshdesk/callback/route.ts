/**
 * Freshdesk OAuth Callback
 *
 * Handles the OAuth callback from Freshdesk and stores the tokens.
 */

import { createOAuthCallbackHandler, freshdeskConfig } from "veryfront/oauth";
import { tokenStore } from "../../../../../lib/token-store.ts";
import { oauthMemoryTokenStore } from "../../../../../lib/oauth-memory-store.ts";

type Tokens = { accessToken: string; refreshToken?: string; expiresAt?: number };
type StateMeta = {
  userId: string;
  serviceId: string;
  codeVerifier?: string;
  redirectUri?: string;
  scopes?: string[];
  createdAt: number;
};

// Hybrid adapter: uses framework's oauthMemoryTokenStore for state (PKCE),
// but user's tokenStore for actual token storage. Tokens are keyed by
// (serviceId, userId) — NEVER share a single slot across users.
const hybridTokenStore = {
  getTokens(serviceId: string, userId: string): Promise<Tokens | null> {
    return tokenStore.getToken(userId, serviceId);
  },
  async setTokens(serviceId: string, userId: string, tokens: Tokens): Promise<void> {
    await tokenStore.setToken(userId, serviceId, tokens);
  },
  async clearTokens(serviceId: string, userId: string): Promise<void> {
    await tokenStore.revokeToken(userId, serviceId);
  },
  setState(state: string, meta: StateMeta): ReturnType<typeof oauthMemoryTokenStore.setState> {
    return oauthMemoryTokenStore.setState(state, meta);
  },
  consumeState(state: string): ReturnType<typeof oauthMemoryTokenStore.consumeState> {
    return oauthMemoryTokenStore.consumeState(state);
  },
};

export const GET = createOAuthCallbackHandler(freshdeskConfig, { tokenStore: hybridTokenStore });
