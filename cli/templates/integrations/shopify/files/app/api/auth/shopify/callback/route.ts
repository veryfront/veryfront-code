import { createOAuthCallbackHandler, memoryTokenStore, shopifyConfig } from "veryfront/oauth";
import { tokenStore } from "../../../../../lib/token-store.ts";

const USER_ID = "current-user";

const hybridTokenStore = {
  getTokens(serviceId: string) {
    return tokenStore.getToken(USER_ID, serviceId);
  },
  async setTokens(
    serviceId: string,
    tokens: { accessToken: string; refreshToken?: string; expiresAt?: number },
  ) {
    await tokenStore.setToken(USER_ID, serviceId, tokens);
  },
  async clearTokens(serviceId: string) {
    await tokenStore.revokeToken(USER_ID, serviceId);
  },
  getState(state: string) {
    return memoryTokenStore.getState(state);
  },
  setState(state: { state: string; codeVerifier?: string; createdAt: number }) {
    return memoryTokenStore.setState(state);
  },
  clearState(state: string) {
    return memoryTokenStore.clearState(state);
  },
};

export const GET = createOAuthCallbackHandler(shopifyConfig, { tokenStore: hybridTokenStore });
