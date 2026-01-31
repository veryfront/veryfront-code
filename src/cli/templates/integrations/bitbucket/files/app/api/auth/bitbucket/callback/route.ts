/**
 * Bitbucket OAuth Callback
 *
 * Handles the OAuth callback from Atlassian and stores the tokens.
 */

import { bitbucketConfig, createOAuthCallbackHandler, memoryTokenStore } from "veryfront/oauth";
import { tokenStore } from "../../../../../lib/token-store.ts";

const USER_ID = "current-user";

const hybridTokenStore = {
  async getTokens(serviceId: string): Promise<unknown> {
    return tokenStore.getToken(USER_ID, serviceId);
  },

  async setTokens(
    serviceId: string,
    tokens: { accessToken: string; refreshToken?: string; expiresAt?: number },
  ): Promise<void> {
    await tokenStore.setToken(USER_ID, serviceId, tokens);
  },

  async clearTokens(serviceId: string): Promise<void> {
    await tokenStore.revokeToken(USER_ID, serviceId);
  },

  getState(state: string): unknown {
    return memoryTokenStore.getState(state);
  },

  setState(state: { state: string; codeVerifier?: string; createdAt: number }): unknown {
    return memoryTokenStore.setState(state);
  },

  clearState(state: string): unknown {
    return memoryTokenStore.clearState(state);
  },
};

export const GET = createOAuthCallbackHandler(bitbucketConfig, { tokenStore: hybridTokenStore });
