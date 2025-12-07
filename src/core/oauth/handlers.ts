/**
 * OAuth Route Handlers
 *
 * Reusable route handlers for OAuth init and callback endpoints.
 * Reduces boilerplate code per integration by ~50%.
 */

import type {
  OAuthHandlerOptions,
  OAuthTokenResponse,
  ServiceOAuthConfig,
  TokenData,
  TokenStore,
} from "./types.ts";
import { getTokenStore } from "./token-store.ts";

// Get environment variable cross-platform
function getEnv(name: string): string | undefined {
  if (typeof Deno !== "undefined") {
    // @ts-ignore: Deno global
    return Deno.env.get(name);
  }
  // @ts-ignore: Node.js process global
  return globalThis.process?.env?.[name];
}

/**
 * Get the base URL for redirects
 */
function getBaseUrl(request: Request): string {
  const url = new URL(request.url);
  return getEnv("NEXT_PUBLIC_APP_URL") || `${url.protocol}//${url.host}`;
}

/**
 * Build the full OAuth authorization URL
 */
export function buildAuthorizationUrl(config: ServiceOAuthConfig, request: Request): string {
  const clientId = getEnv(config.clientIdEnv);
  if (!clientId) {
    throw new Error(`${config.clientIdEnv} not configured`);
  }

  const baseUrl = getBaseUrl(request);
  const redirectUri = `${baseUrl}${config.callbackPath}`;
  const state = crypto.randomUUID();

  // Combine provider scopes with service-specific scopes
  const allScopes = [...config.scopes, ...(config.serviceScopes || [])];

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    state,
    ...(allScopes.length > 0 && { scope: allScopes.join(" ") }),
    ...config.additionalParams,
  });

  return `${config.authorizationUrl}?${params}`;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(
  config: ServiceOAuthConfig,
  code: string,
  request: Request,
): Promise<OAuthTokenResponse> {
  const clientId = getEnv(config.clientIdEnv);
  const clientSecret = getEnv(config.clientSecretEnv);

  if (!clientId || !clientSecret) {
    throw new Error(`Missing ${config.clientIdEnv} or ${config.clientSecretEnv}`);
  }

  const baseUrl = getBaseUrl(request);
  const redirectUri = `${baseUrl}${config.callbackPath}`;

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };

  // Some providers require Basic auth for token endpoint
  if (config.tokenAuthMethod === "basic") {
    const credentials = btoa(`${clientId}:${clientSecret}`);
    headers["Authorization"] = `Basic ${credentials}`;
  }

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers,
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token exchange failed: ${response.status} ${errorText}`);
  }

  return response.json();
}

/**
 * Refresh an expired access token
 */
export async function refreshAccessToken(
  config: ServiceOAuthConfig,
  refreshToken: string,
): Promise<OAuthTokenResponse> {
  const clientId = getEnv(config.clientIdEnv);
  const clientSecret = getEnv(config.clientSecretEnv);

  if (!clientId || !clientSecret) {
    throw new Error(`Missing ${config.clientIdEnv} or ${config.clientSecretEnv}`);
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };

  if (config.tokenAuthMethod === "basic") {
    const credentials = btoa(`${clientId}:${clientSecret}`);
    headers["Authorization"] = `Basic ${credentials}`;
  }

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers,
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token refresh failed: ${response.status} ${errorText}`);
  }

  return response.json();
}

/**
 * Create a reusable OAuth init handler
 *
 * @example
 * // app/api/auth/gmail/route.ts
 * import { createOAuthInitHandler, createGmailConfig } from "@veryfront/oauth";
 * export const GET = createOAuthInitHandler({ config: createGmailConfig() });
 */
export function createOAuthInitHandler(
  options: Pick<OAuthHandlerOptions, "config">,
): (request: Request) => Response {
  return (request: Request) => {
    try {
      const authUrl = buildAuthorizationUrl(options.config, request);
      return Response.redirect(authUrl, 302);
    } catch (error) {
      console.error("OAuth init error:", error);
      return Response.json(
        { error: error instanceof Error ? error.message : "OAuth initialization failed" },
        { status: 500 },
      );
    }
  };
}

/**
 * Create a reusable OAuth callback handler
 *
 * @example
 * // app/api/auth/gmail/callback/route.ts
 * import { createOAuthCallbackHandler, createGmailConfig } from "@veryfront/oauth";
 * export const GET = createOAuthCallbackHandler({ config: createGmailConfig() });
 */
export function createOAuthCallbackHandler(
  options: OAuthHandlerOptions,
): (request: Request) => Promise<Response> {
  const {
    config,
    tokenStore = getTokenStore(),
    successRedirect = "/?connected=" + config.service,
    errorRedirect = "/?error=oauth_failed",
    onSuccess,
    onError,
  } = options;

  return async (request: Request) => {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");
    const errorDescription = url.searchParams.get("error_description");
    const baseUrl = getBaseUrl(request);

    // Handle OAuth errors
    if (error) {
      console.error(`OAuth error for ${config.service}:`, error, errorDescription);
      const err = new Error(errorDescription || error);

      if (onError) {
        await onError(err, request);
      }

      const redirectUrl = new URL(errorRedirect, baseUrl);
      redirectUrl.searchParams.set("service", config.service);
      redirectUrl.searchParams.set("error", error);
      return Response.redirect(redirectUrl.toString(), 302);
    }

    // Handle missing code
    if (!code) {
      const redirectUrl = new URL(errorRedirect, baseUrl);
      redirectUrl.searchParams.set("service", config.service);
      redirectUrl.searchParams.set("error", "no_code");
      return Response.redirect(redirectUrl.toString(), 302);
    }

    try {
      // Exchange code for tokens
      const tokenResponse = await exchangeCodeForTokens(config, code, request);

      // Build token data
      const tokenData: TokenData = {
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token,
        expiresAt: tokenResponse.expires_in
          ? Date.now() + tokenResponse.expires_in * 1000
          : undefined,
        metadata: {
          // Store any additional fields (e.g., instance_url for Salesforce)
          ...tokenResponse,
        },
      };

      // Delete sensitive fields from metadata
      if (tokenData.metadata) {
        delete tokenData.metadata.access_token;
        delete tokenData.metadata.refresh_token;
      }

      // Store tokens
      await tokenStore.setTokens(config.service, tokenData);

      // Call success callback if provided
      if (onSuccess) {
        await onSuccess(tokenData, request);
      }

      // Redirect to success URL
      return Response.redirect(new URL(successRedirect, baseUrl).toString(), 302);
    } catch (err) {
      console.error(`OAuth callback error for ${config.service}:`, err);

      if (onError) {
        await onError(err instanceof Error ? err : new Error(String(err)), request);
      }

      const redirectUrl = new URL(errorRedirect, baseUrl);
      redirectUrl.searchParams.set("service", config.service);
      redirectUrl.searchParams.set("error", "token_exchange_failed");
      return Response.redirect(redirectUrl.toString(), 302);
    }
  };
}

/**
 * Get a valid access token, refreshing if necessary
 */
export async function getValidAccessToken(
  config: ServiceOAuthConfig,
  tokenStore: TokenStore = getTokenStore(),
): Promise<string | null> {
  const tokens = await tokenStore.getTokens(config.service);
  if (!tokens) {
    return null;
  }

  // Check if token is expired (with 5 minute buffer)
  const isExpired = tokens.expiresAt && Date.now() > tokens.expiresAt - 5 * 60 * 1000;

  if (isExpired && tokens.refreshToken) {
    try {
      const newTokens = await refreshAccessToken(config, tokens.refreshToken);

      const updatedTokenData: TokenData = {
        accessToken: newTokens.access_token,
        refreshToken: newTokens.refresh_token || tokens.refreshToken,
        expiresAt: newTokens.expires_in
          ? Date.now() + newTokens.expires_in * 1000
          : tokens.expiresAt,
        metadata: tokens.metadata,
      };

      await tokenStore.setTokens(config.service, updatedTokenData);
      return updatedTokenData.accessToken;
    } catch (error) {
      console.error(`Failed to refresh token for ${config.service}:`, error);
      // Token refresh failed, clear tokens and return null
      await tokenStore.deleteTokens(config.service);
      return null;
    }
  }

  return tokens.accessToken;
}

/**
 * Check if a service is connected (has valid tokens)
 */
export async function isServiceConnected(
  config: ServiceOAuthConfig,
  tokenStore: TokenStore = getTokenStore(),
): Promise<boolean> {
  const token = await getValidAccessToken(config, tokenStore);
  return token !== null;
}

/**
 * Disconnect a service (delete tokens)
 */
export async function disconnectService(
  config: ServiceOAuthConfig,
  tokenStore: TokenStore = getTokenStore(),
): Promise<void> {
  await tokenStore.deleteTokens(config.service);
}
