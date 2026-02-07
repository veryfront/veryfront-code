/**
 * Freshdesk OAuth Callback
 *
 * Handles the OAuth callback from Freshdesk and stores the tokens.
 */

import { createOAuthCallbackHandler, freshdeskConfig } from "veryfront/oauth";
import { tokenStore } from "../../../../../lib/token-store.ts";
import { oauthMemoryTokenStore } from "../../../../../lib/oauth-memory-store.ts";


type Tokens = { accessToken: string; refreshToken?: string; expiresAt?: number };
type State = { state: string; codeVerifier?: string; createdAt: number };

// Hybrid adapter: uses framework's oauthMemoryTokenStore for state (PKCE),
// but user's tokenStore for actual token storage
const hybridTokenStore = {
  getTokens(serviceId: string): Promise<Tokens | null> {
    return tokenStore.getToken("current-user", serviceId);
  },
  async setTokens(serviceId: string, tokens: Tokens): Promise<void> {
    await tokenStore.setToken("current-user", serviceId, tokens);
  },
  async clearTokens(serviceId: string): Promise<void> {
    await tokenStore.revokeToken("current-user", serviceId);
  },
  getState(state: string): ReturnType<typeof oauthMemoryTokenStore.getState> {
    return oauthMemoryTokenStore.getState(state);
  },
  setState(stateObj: State): ReturnType<typeof oauthMemoryTokenStore.setState> {
    return oauthMemoryTokenStore.setState(stateObj);
  },
  clearState(state: string): ReturnType<typeof oauthMemoryTokenStore.clearState> {
    return oauthMemoryTokenStore.clearState(state);
  },
};

export const GET = createOAuthCallbackHandler(freshdeskConfig, { tokenStore: hybridTokenStore });
