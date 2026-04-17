import { createOAuthCallbackHandler, notionConfig } from "veryfront/oauth";
import { tokenStore } from "../../../../../lib/token-store.ts";
import { oauthMemoryTokenStore } from "../../../../../lib/oauth-memory-store.ts";

const hybridTokenStore = {
  async getTokens(serviceId: string, userId: string) {
    return tokenStore.getToken(userId, serviceId);
  },
  async setTokens(
    serviceId: string,
    userId: string,
    tokens: { accessToken: string; refreshToken?: string; expiresAt?: number },
  ) {
    await tokenStore.setToken(userId, serviceId, tokens);
  },
  async clearTokens(serviceId: string, userId: string) {
    await tokenStore.revokeToken(userId, serviceId);
  },
  async getState(state: string) {
    return oauthMemoryTokenStore.getState(state);
  },
  async setState(state: { state: string; codeVerifier?: string; createdAt: number }) {
    await oauthMemoryTokenStore.setState(state);
  },
  async clearState(state: string) {
    await oauthMemoryTokenStore.clearState(state);
  },
};

export const GET = createOAuthCallbackHandler(notionConfig, { tokenStore: hybridTokenStore });
