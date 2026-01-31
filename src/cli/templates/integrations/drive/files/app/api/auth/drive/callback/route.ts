/**
 * Google Drive OAuth Callback
 *
 * Handles the OAuth callback from Google and stores the tokens.
 */

import { createOAuthCallbackHandler, driveConfig, memoryTokenStore } from "veryfront/oauth";
import { tokenStore } from "../../../../../lib/token-store.ts";

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
    return memoryTokenStore.getState(state);
  },
  setState(state: { state: string; codeVerifier?: string; createdAt: number }) {
    return memoryTokenStore.setState(state);
  },
  clearState(state: string) {
    return memoryTokenStore.clearState(state);
  },
};

export const GET = createOAuthCallbackHandler(driveConfig, { tokenStore: hybridTokenStore });
