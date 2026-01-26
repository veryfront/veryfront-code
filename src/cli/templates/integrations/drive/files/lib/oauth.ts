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

function buildTokenRequest(
  provider: OAuthProvider,
  body: Record<string, string>,
): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: provider.clientId,
      client_secret: provider.clientSecret,
      ...body,
    }),
  };
}

async function fetchToken(
  provider: OAuthProvider,
  body: Record<string, string>,
  errorPrefix: string,
): Promise<any> {
  const response = await fetch(provider.tokenUrl, buildTokenRequest(provider, body));

  if (response.ok) {
    return response.json();
  }

  const error = await response.text();
  throw new Error(`${errorPrefix}: ${response.status} - ${error}`);
}

function toOAuthToken(data: any, fallbackRefreshToken?: string): OAuthToken {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? fallbackRefreshToken,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
    tokenType: data.token_type ?? "Bearer",
    scope: data.scope,
  };
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
  const data = await fetchToken(
    provider,
    {
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    },
    "Token exchange failed",
  );

  return toOAuthToken(data);
}

export async function refreshAccessToken(
  provider: OAuthProvider,
  refreshToken: string,
): Promise<OAuthToken> {
  const data = await fetchToken(
    provider,
    {
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    },
    "Token refresh failed",
  );

  return toOAuthToken(data, refreshToken);
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

  if (!isExpired || !token.refreshToken) {
    return token.accessToken;
  }

  try {
    const newToken = await refreshAccessToken(provider, token.refreshToken);
    await tokenStore.setToken(userId, service, newToken);
    return newToken.accessToken;
  } catch {
    await tokenStore.revokeToken(userId, service);
    return null;
  }
}
