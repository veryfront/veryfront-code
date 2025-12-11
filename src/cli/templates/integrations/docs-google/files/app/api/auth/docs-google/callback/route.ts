
import { createOAuthCallbackHandler, docsGoogleConfig, memoryTokenStore } from "veryfront/oauth";
import { tokenStore } from "../../../../../lib/token-store.ts";

const hybridTokenStore = {
  async getTokens(serviceId: string) {
    return tokenStore.getToken("current-user", serviceId);
  },
  async setTokens(serviceId: string, tokens: { accessToken: string; refreshToken?: string; expiresAt?: number }) {
    await tokenStore.setToken("current-user", serviceId, tokens);
  },
  async clearTokens(serviceId: string) {
    await tokenStore.revokeToken("current-user", serviceId);
  },
  getState: (state: string) => memoryTokenStore.getState(state),
  setState: (state: { state: string; codeVerifier?: string; createdAt: number }) => memoryTokenStore.setState(state),
  clearState: (state: string) => memoryTokenStore.clearState(state),
};

export const GET = createOAuthCallbackHandler(docsGoogleConfig, {
  tokenStore: hybridTokenStore,
});
