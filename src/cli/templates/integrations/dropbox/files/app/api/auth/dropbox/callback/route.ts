/**
 * Dropbox OAuth Callback
 *
 * Handles the OAuth callback from Dropbox and stores the tokens.
 */

import { createOAuthCallbackHandler, dropboxConfig, memoryTokenStore } from "veryfront/oauth";
import { tokenStore } from "../../../../../lib/token-store.ts";

// Hybrid adapter: uses framework's memoryTokenStore for state (PKCE),
// but user's tokenStore for actual token storage
const hybridTokenStore = {
  // Token methods - delegate to user's tokenStore
  async getTokens(serviceId: string) {
    return tokenStore.getToken("current-user", serviceId);
  },
  async setTokens(serviceId: string, tokens: { accessToken: string; refreshToken?: string; expiresAt?: number }) {
    await tokenStore.setToken("current-user", serviceId, tokens);
  },
  async clearTokens(serviceId: string) {
    await tokenStore.revokeToken("current-user", serviceId);
  },
  // State methods - delegate to framework's memoryTokenStore (shared with init route)
  getState: (state: string) => memoryTokenStore.getState(state),
  setState: (state: { state: string; codeVerifier?: string; createdAt: number }) => memoryTokenStore.setState(state),
  clearState: (state: string) => memoryTokenStore.clearState(state),
};

export const GET = createOAuthCallbackHandler(dropboxConfig, {
  tokenStore: hybridTokenStore,
});
