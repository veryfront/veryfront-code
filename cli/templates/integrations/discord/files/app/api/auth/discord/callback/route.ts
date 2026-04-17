/**
 * Discord OAuth Callback
 *
 * Handles the OAuth callback from Discord and stores the tokens.
 */

import { createOAuthCallbackHandler, discordConfig } from "veryfront/oauth";
import { tokenStore } from "../../../../../lib/token-store.ts";
import { oauthMemoryTokenStore } from "../../../../../lib/oauth-memory-store.ts";

const hybridTokenStore = {
  getTokens(serviceId: string, userId: string) {
    return tokenStore.getToken(userId, serviceId);
  },
  setTokens(
    serviceId: string,
    tokens: { accessToken: string; refreshToken?: string; expiresAt?: number },
  ) {
    return tokenStore.setToken(USER_ID, serviceId, tokens);
  },
  clearTokens(serviceId: string) {
    return tokenStore.revokeToken(USER_ID, serviceId);
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

export const GET = createOAuthCallbackHandler(discordConfig, { tokenStore: hybridTokenStore });
