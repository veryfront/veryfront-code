import type { OAuthServiceConfig } from "veryfront/oauth";
import { getEnv } from "./env.ts";
import {
  getRefreshableAccessToken,
  type OAuthToken,
  tokenStore,
} from "./token-store.ts";

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
  if (typeof expiresIn !== "number" || expiresIn <= 0) return undefined;
  return Date.now() + expiresIn * 1000;
}

async function postTokenRequest(
  provider: OAuthProvider,
  body: Record<string, string>,
  errorPrefix: string,
): Promise<any> {
  const response = await fetch(provider.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });

  if (response.ok) return response.json();

  const error = await response.text();
  throw new Error(`${errorPrefix}: ${response.status} - ${error}`);
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
  const data = await postTokenRequest(
    provider,
    {
      client_id: provider.clientId,
      client_secret: provider.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    },
    "Token exchange failed",
  );

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
  const data = await postTokenRequest(
    provider,
    {
      client_id: provider.clientId,
      client_secret: provider.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    },
    "Token refresh failed",
  );

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
  return await getRefreshableAccessToken(
    tokenStore,
    service,
    userId,
    provider.scopes,
    (refreshToken) => refreshAccessToken(provider, refreshToken),
  );
}

/**
 * Build a provider from a veryfront/oauth config, with its client credentials
 * from the config's env vars. Use it for providers the generic OAuthService
 * does not support.
 */
export function providerFromConfig(
  config: OAuthServiceConfig,
  urls: Pick<OAuthProvider, "authorizationUrl" | "tokenUrl"> = config,
): OAuthProvider {
  return {
    name: config.serviceId,
    authorizationUrl: urls.authorizationUrl,
    tokenUrl: urls.tokenUrl,
    clientId: getEnv(config.clientIdEnvVar) ?? "",
    clientSecret: getEnv(config.clientSecretEnvVar) ?? "",
    scopes: [...config.defaultScopes],
    callbackPath: `/api/auth/${config.serviceId}/callback`,
  };
}
