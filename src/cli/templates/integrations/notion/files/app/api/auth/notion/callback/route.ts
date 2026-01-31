import { createOAuthCallbackHandler, memoryTokenStore, notionConfig } from "veryfront/oauth";
import { tokenStore } from "../../../../../lib/token-store.ts";

const USER_ID = "current-user";

const hybridTokenStore = {
  async getTokens(serviceId: string) {
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
  async getState(state: string) {
    return memoryTokenStore.getState(state);
  },
  async setState(state: { state: string; codeVerifier?: string; createdAt: number }) {
    await memoryTokenStore.setState(state);
  },
  async clearState(state: string) {
    await memoryTokenStore.clearState(state);
  },
};

export const GET = createOAuthCallbackHandler(notionConfig, { tokenStore: hybridTokenStore });
