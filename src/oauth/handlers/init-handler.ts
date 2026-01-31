import { logger } from "#veryfront/utils";
import { getRuntimeEnv, type RuntimeEnv } from "#veryfront/config/runtime-env.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import { type EnvReader, OAuthService } from "../providers/base.ts";
import type { AuthorizationUrlOptions, OAuthServiceConfig, TokenStore } from "../types.ts";
import { memoryTokenStore } from "../token-store/memory.ts";

export interface OAuthInitHandlerOptions {
  /** Token store to use (defaults to memory store) */
  tokenStore?: TokenStore;

  /** Base URL for callbacks (defaults to APP_URL or localhost) */
  baseUrl?: string;

  /** Additional authorization options */
  authOptions?: AuthorizationUrlOptions;

  /** RuntimeEnv for test isolation (defaults to getRuntimeEnv()) */
  env?: RuntimeEnv;

  /** EnvReader for dynamic env vars (defaults to getEnv) */
  envReader?: EnvReader;
}

export function createOAuthInitHandler(
  config: OAuthServiceConfig,
  options: OAuthInitHandlerOptions = {},
): () => Promise<Response> {
  const tokenStore = options.tokenStore ?? memoryTokenStore;
  const authOptions = options.authOptions ?? {};
  const env = options.env ?? getRuntimeEnv();
  const envReader = options.envReader ?? getEnv;

  return async function handler(): Promise<Response> {
    const service = new OAuthService(config, tokenStore, envReader);

    if (!service.isConfigured()) {
      return Response.json(
        {
          error: `${config.displayName} OAuth not configured`,
          details: `Missing ${config.clientIdEnvVar} or ${config.clientSecretEnvVar}`,
        },
        { status: 500 },
      );
    }

    const appUrl = options.baseUrl ?? env.appUrl ?? "http://localhost:3000";
    const redirectUri = `${appUrl}/api/auth/${config.serviceId}/callback`;

    try {
      const { url, state } = await service.createAuthorizationUrl({ ...authOptions, redirectUri });
      await tokenStore.setState(state);
      return Response.redirect(url);
    } catch (error) {
      logger.error("[OAuth] Init error", { serviceId: config.serviceId }, error);

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

export interface OAuthStatusHandlerOptions {
  /** Token store to use (defaults to memory store) */
  tokenStore?: TokenStore;

  /** EnvReader for dynamic env vars (defaults to getEnv) */
  envReader?: EnvReader;
}

export function createOAuthStatusHandler(
  config: OAuthServiceConfig,
  options: OAuthStatusHandlerOptions = {},
): () => Promise<Response> {
  const tokenStore = options.tokenStore ?? memoryTokenStore;
  const envReader = options.envReader ?? getEnv;

  return async function handler(): Promise<Response> {
    const tokens = await tokenStore.getTokens(config.serviceId);

    const isConnected = !!tokens?.accessToken;
    const isExpired = tokens?.expiresAt ? Date.now() > tokens.expiresAt : false;
    const hasRefreshToken = !!tokens?.refreshToken;

    return Response.json({
      service: config.serviceId,
      displayName: config.displayName,
      connected: isConnected && (!isExpired || hasRefreshToken),
      configured: !!(envReader(config.clientIdEnvVar) && envReader(config.clientSecretEnvVar)),
      expiresAt: tokens?.expiresAt,
      hasRefreshToken,
    });
  };
}

export function createOAuthDisconnectHandler(
  config: OAuthServiceConfig,
  options: { tokenStore?: TokenStore } = {},
): () => Promise<Response> {
  const tokenStore = options.tokenStore ?? memoryTokenStore;

  return async function handler(): Promise<Response> {
    await tokenStore.clearTokens(config.serviceId);

    return Response.json({
      success: true,
      message: `Disconnected from ${config.displayName}`,
    });
  };
}
