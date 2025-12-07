/**
 * OAuth Helper Functions
 *
 * Provides utilities for OAuth 2.0 authorization flows.
 */

import { type OAuthToken, tokenStore } from "./token-store.ts";

export interface OAuthProvider {
  name: string;
  authorizationUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  callbackPath: string;
}

/**
 * Generate OAuth authorization URL
 */
export function getAuthorizationUrl(
  provider: OAuthProvider,
  state: string,
  redirectUri: string,
): string {
  const params = new URLSearchParams({
    client_id: provider.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: provider.scopes.join(" "),
    state,
  });

  return `${provider.authorizationUrl}?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(
  provider: OAuthProvider,
  code: string,
  redirectUri: string,
): Promise<OAuthToken> {
  const response = await fetch(provider.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${provider.clientId}:${provider.clientSecret}`)}`,
    },
    body: new URLSearchParams({
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${response.status} - ${error}`);
  }

  const data = await response.json();

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in ? Date.now() + (data.expires_in * 1000) : undefined,
    tokenType: data.token_type || "Bearer",
    scope: data.scope,
  };
}

/**
 * Refresh an expired access token
 */
export async function refreshAccessToken(
  provider: OAuthProvider,
  refreshToken: string,
): Promise<OAuthToken> {
  const response = await fetch(provider.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${provider.clientId}:${provider.clientSecret}`)}`,
    },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token refresh failed: ${response.status} - ${error}`);
  }

  const data = await response.json();

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: data.expires_in ? Date.now() + (data.expires_in * 1000) : undefined,
    tokenType: data.token_type || "Bearer",
    scope: data.scope,
  };
}

/**
 * Get a valid access token, refreshing if necessary
 */
export async function getValidToken(
  provider: OAuthProvider,
  userId: string,
  service: string,
): Promise<string | null> {
  const token = await tokenStore.getToken(userId, service);

  if (!token) {
    return null;
  }

  // Check if token is expired (with 5 minute buffer)
  // If no expiresAt, token doesn't expire
  const isExpired = token.expiresAt ? token.expiresAt < Date.now() + 5 * 60 * 1000 : false;

  if (isExpired && token.refreshToken) {
    try {
      const newToken = await refreshAccessToken(provider, token.refreshToken);
      await tokenStore.setToken(userId, service, newToken);
      return newToken.accessToken;
    } catch {
      // Refresh failed, user needs to re-authorize
      await tokenStore.revokeToken(userId, service);
      return null;
    }
  }

  return token.accessToken;
}
