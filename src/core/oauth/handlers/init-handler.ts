
import { OAuthService } from "../providers/base.ts";
import type { AuthorizationUrlOptions, OAuthServiceConfig, TokenStore } from "../types.ts";
import { memoryTokenStore } from "../token-store/memory.ts";
import { getEnv } from "../../../platform/compat/process.ts";

export interface OAuthInitHandlerOptions {
  tokenStore?: TokenStore;

  baseUrl?: string;

  authOptions?: AuthorizationUrlOptions;
}

export function createOAuthInitHandler(
  config: OAuthServiceConfig,
  options: OAuthInitHandlerOptions = {},
): () => Promise<Response> {
  const { tokenStore = memoryTokenStore, baseUrl, authOptions = {} } = options;

  return async (): Promise<Response> => {
    const service = new OAuthService(config, tokenStore);

    if (!service.isConfigured()) {
      return Response.json(
        {
          error: `${config.displayName} OAuth not configured`,
          details: `Missing ${config.clientIdEnvVar} or ${config.clientSecretEnvVar}`,
        },
        { status: 500 },
      );
    }

    const appUrl = baseUrl ||
      getEnv("APP_URL") ||
      getEnv("NEXT_PUBLIC_APP_URL") ||
      "http://localhost:3000";

    const redirectUri = `${appUrl}/api/auth/${config.serviceId}/callback`;

    try {
      const { url, state } = await service.createAuthorizationUrl({
        ...authOptions,
        redirectUri,
      });

      await tokenStore.setState(state);

      return Response.redirect(url);
    } catch (error) {
      console.error(`OAuth init error for ${config.serviceId}:`, error);
      return Response.json(
        {
          error: "Failed to initiate OAuth flow",
          details: error instanceof Error ? error.message : "Unknown error",
        },
        { status: 500 },
      );
    }
  };
}

export function createOAuthStatusHandler(
  config: OAuthServiceConfig,
  options: { tokenStore?: TokenStore } = {},
): () => Promise<Response> {
  const { tokenStore = memoryTokenStore } = options;

  return async (): Promise<Response> => {
    const tokens = await tokenStore.getTokens(config.serviceId);

    const isConnected = !!tokens?.accessToken;
    const isExpired = tokens?.expiresAt ? Date.now() > tokens.expiresAt : false;
    const hasRefreshToken = !!tokens?.refreshToken;

    return Response.json({
      service: config.serviceId,
      displayName: config.displayName,
      connected: isConnected && (!isExpired || hasRefreshToken),
      configured: !!(getEnv(config.clientIdEnvVar) && getEnv(config.clientSecretEnvVar)),
      expiresAt: tokens?.expiresAt,
      hasRefreshToken,
    });
  };
}

export function createOAuthDisconnectHandler(
  config: OAuthServiceConfig,
  options: { tokenStore?: TokenStore } = {},
): () => Promise<Response> {
  const { tokenStore = memoryTokenStore } = options;

  return async (): Promise<Response> => {
    await tokenStore.clearTokens(config.serviceId);

    return Response.json({
      success: true,
      message: `Disconnected from ${config.displayName}`,
    });
  };
}
