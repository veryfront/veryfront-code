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

function getExpiresAt(expiresIn: unknown): number | undefined {
  if (typeof expiresIn !== "number") return undefined;
  return Date.now() + expiresIn * 1000;
}

async function postForm(url: string, body: Record<string, string>): Promise<any> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });

  if (response.ok) return response.json();

  const error = await response.text();
  throw new Error(`Token request failed: ${response.status} - ${error}`);
}

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
    access_type: "offline",
    prompt: "consent",
  });

  return `${provider.authorizationUrl}?${params.toString()}`;
}

export async function exchangeCodeForTokens(
  provider: OAuthProvider,
  code: string,
  redirectUri: string,
): Promise<OAuthToken> {
  const data = await postForm(provider.tokenUrl, {
    client_id: provider.clientId,
    client_secret: provider.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: getExpiresAt(data.expires_in),
    tokenType: data.token_type ?? "Bearer",
    scope: data.scope,
  };
}

export async function refreshAccessToken(
  provider: OAuthProvider,
  refreshToken: string,
): Promise<OAuthToken> {
  const data = await postForm(provider.tokenUrl, {
    client_id: provider.clientId,
    client_secret: provider.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt: getExpiresAt(data.expires_in),
    tokenType: data.token_type ?? "Bearer",
    scope: data.scope,
  };
}

export async function getValidToken(
  provider: OAuthProvider,
  userId: string,
  service: string,
): Promise<string | null> {
  const token = await tokenStore.getToken(userId, service);
  if (!token) return null;

  const isExpired = token.expiresAt
    ? token.expiresAt < Date.now() + 5 * 60 * 1000
    : false;

  if (!isExpired || !token.refreshToken) return token.accessToken;

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
