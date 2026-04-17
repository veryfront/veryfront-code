/**
 * Bitbucket OAuth Callback
 *
 * Handles the OAuth callback from Atlassian and stores the tokens.
 */

import { bitbucketConfig, createOAuthCallbackHandler } from "veryfront/oauth";
import { tokenStore } from "../../../../../lib/token-store.ts";
import { oauthMemoryTokenStore } from "../../../../../lib/oauth-memory-store.ts";

const hybridTokenStore = {
  async getTokens(serviceId: string, userId: string): Promise<unknown> {
    return tokenStore.getToken(userId, serviceId);
  },

  async setTokens(
    serviceId: string,
    userId: string,
    tokens: { accessToken: string; refreshToken?: string; expiresAt?: number },
  ): Promise<void> {
    await tokenStore.setToken(userId, serviceId, tokens);
  },

  async clearTokens(serviceId: string, userId: string): Promise<void> {
    await tokenStore.revokeToken(userId, serviceId);
  },

  getState(state: string): unknown {
    return oauthMemoryTokenStore.getState(state);
  },

  setState(state: { state: string; codeVerifier?: string; createdAt: number }): unknown {
    return oauthMemoryTokenStore.setState(state);
  },

  clearState(state: string): unknown {
    return oauthMemoryTokenStore.clearState(state);
  },
};

export const GET = createOAuthCallbackHandler(bitbucketConfig, { tokenStore: hybridTokenStore });
