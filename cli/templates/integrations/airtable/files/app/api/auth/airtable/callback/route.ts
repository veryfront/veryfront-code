import { airtableConfig, createOAuthCallbackHandler } from "veryfront/oauth";
import { tokenStore } from "../../../../../lib/token-store.ts";
import { oauthMemoryTokenStore } from "../../../../../lib/oauth-memory-store.ts";


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
    return oauthMemoryTokenStore.getState(state);
  },
  setState(state: { state: string; codeVerifier?: string; createdAt: number }) {
    return oauthMemoryTokenStore.setState(state);
  },
  clearState(state: string) {
    return oauthMemoryTokenStore.clearState(state);
  },
};

export const GET = createOAuthCallbackHandler(airtableConfig, { tokenStore: hybridTokenStore });
