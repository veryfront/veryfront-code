import { createOAuthCallbackHandler, salesforceConfig } from "veryfront/oauth";
import { tokenStore } from "../../../../../lib/token-store.ts";
import { oauthMemoryTokenStore } from "../../../../../lib/oauth-memory-store.ts";

const hybridTokenStore = {
  getTokens(serviceId: string, userId: string) {
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
  setState(
    state: string,
    meta: {
      userId: string;
      serviceId: string;
      codeVerifier?: string;
      redirectUri?: string;
      scopes?: string[];
      createdAt: number;
    },
  ) {
    return oauthMemoryTokenStore.setState(state, meta);
  },
  consumeState(state: string) {
    return oauthMemoryTokenStore.consumeState(state);
  },
};

export const GET = createOAuthCallbackHandler(salesforceConfig, { tokenStore: hybridTokenStore });
