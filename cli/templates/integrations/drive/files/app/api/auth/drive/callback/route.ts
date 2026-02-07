/**
 * Google Drive OAuth Callback
 *
 * Handles the OAuth callback from Google and stores the tokens.
 */

import { createOAuthCallbackHandler, driveConfig } from "veryfront/oauth";
import { tokenStore } from "../../../../../lib/token-store.ts";
import { oauthMemoryTokenStore } from "../../../../../lib/oauth-memory-store.ts";


const USER_ID = "current-user";

const hybridTokenStore = {
  getTokens(serviceId: string) {
    return tokenStore.getToken(USER_ID, serviceId);
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

export const GET = createOAuthCallbackHandler(driveConfig, { tokenStore: hybridTokenStore });
