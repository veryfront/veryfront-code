/**
 * OneDrive OAuth Callback
 *
 * Handles the OAuth callback from Microsoft and stores the tokens.
 */

import { createOAuthCallbackHandler, oneDriveConfig } from "veryfront/oauth";
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
  ): Promise<void> {
    return oauthMemoryTokenStore.setState(state, meta);
  },
  consumeState(state: string): Promise<unknown> {
    return oauthMemoryTokenStore.consumeState(state);
  },
};

export const GET = createOAuthCallbackHandler(oneDriveConfig, { tokenStore: hybridTokenStore });
