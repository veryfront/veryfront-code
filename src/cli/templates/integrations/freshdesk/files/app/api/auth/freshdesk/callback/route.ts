/**
 * Freshdesk OAuth Callback
 *
 * Handles the OAuth callback from Freshdesk and stores the tokens.
 */

import { createOAuthCallbackHandler, freshdeskConfig, memoryTokenStore } from "veryfront/oauth";
import { tokenStore } from "../../../../../lib/token-store.ts";

type Tokens = { accessToken: string; refreshToken?: string; expiresAt?: number };
type State = { state: string; codeVerifier?: string; createdAt: number };

// Hybrid adapter: uses framework's memoryTokenStore for state (PKCE),
// but user's tokenStore for actual token storage
const hybridTokenStore = {
  async getTokens(serviceId: string): Promise<Tokens | null> {
    return tokenStore.getToken("current-user", serviceId);
  },
  async setTokens(serviceId: string, tokens: Tokens): Promise<void> {
    await tokenStore.setToken("current-user", serviceId, tokens);
  },
  async clearTokens(serviceId: string): Promise<void> {
    await tokenStore.revokeToken("current-user", serviceId);
  },
  getState(state: string): ReturnType<typeof memoryTokenStore.getState> {
    return memoryTokenStore.getState(state);
  },
  setState(state: State): ReturnType<typeof memoryTokenStore.setState> {
    return memoryTokenStore.setState(state);
  },
  clearState(state: string): ReturnType<typeof memoryTokenStore.clearState> {
    return memoryTokenStore.clearState(state);
  },
};

export const GET = createOAuthCallbackHandler(freshdeskConfig, { tokenStore: hybridTokenStore });
