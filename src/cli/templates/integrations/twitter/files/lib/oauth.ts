/**
 * OAuth Helper Functions with PKCE support
 *
 * Provides utilities for OAuth 2.0 authorization flows with PKCE (Proof Key for Code Exchange).
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
  usePKCE?: boolean;
}

/**
 * Generate a cryptographically secure random string
 */
function generateRandomString(length: number): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Generate code verifier for PKCE
 */
export function generateCodeVerifier(): string {
  return generateRandomString(32);
}

/**
 * Generate code challenge from verifier using SHA-256
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  const base64 = btoa(String.fromCharCode(...new Uint8Array(hash)));
  // Convert to base64url (RFC 4648)
  return base64
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/**
 * Generate OAuth authorization URL
 */
export function getAuthorizationUrl(
  provider: OAuthProvider,
  state: string,
  redirectUri: string,
  codeChallenge?: string,
): string {
  const params = new URLSearchParams({
    client_id: provider.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: provider.scopes.join(" "),
    state,
  });

  // Add PKCE parameters if enabled
  if (provider.usePKCE && codeChallenge) {
    params.set("code_challenge", codeChallenge);
    params.set("code_challenge_method", "S256");
  }

  return `${provider.authorizationUrl}?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(
  provider: OAuthProvider,
  code: string,
  redirectUri: string,
  codeVerifier?: string,
): Promise<OAuthToken> {
  const body = new URLSearchParams({
    client_id: provider.clientId,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });

  // Add PKCE verifier if used
  if (provider.usePKCE && codeVerifier) {
    body.set("code_verifier", codeVerifier);
  }

  // Only add client_secret if not using PKCE (PKCE uses public clients)
  if (!provider.usePKCE) {
    body.set("client_secret", provider.clientSecret);
  }

  const response = await fetch(provider.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
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
  const body = new URLSearchParams({
    client_id: provider.clientId,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  // Only add client_secret if not using PKCE
  if (!provider.usePKCE) {
    body.set("client_secret", provider.clientSecret);
  }

  const response = await fetch(provider.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
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
  // If no expiresAt, token doesn't expire (e.g., GitHub)
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
