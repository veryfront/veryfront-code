import * as dntShim from "../../../_dnt.shims.js";
import { logger } from "../../utils/index.js";
import { type EnvReader, OAuthService } from "../providers/base.js";
import type { AuthorizationUrlOptions, OAuthServiceConfig, TokenStore } from "../types.js";
import { memoryTokenStore } from "../token-store/memory.js";
import { getEnv } from "../../platform/compat/process.js";
import { getRuntimeEnv, type RuntimeEnv } from "../../config/runtime-env.js";

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
): () => Promise<dntShim.Response> {
  const tokenStore = options.tokenStore ?? memoryTokenStore;
  const baseUrl = options.baseUrl;
  const authOptions = options.authOptions ?? {};
  const env = options.env ?? getRuntimeEnv();
  const envReader = options.envReader ?? getEnv;

  return async function handler(): Promise<dntShim.Response> {
    const service = new OAuthService(config, tokenStore, envReader);

    if (!service.isConfigured()) {
      return dntShim.Response.json(
        {
          error: `${config.displayName} OAuth not configured`,
          details: `Missing ${config.clientIdEnvVar} or ${config.clientSecretEnvVar}`,
        },
        { status: 500 },
      );
    }

    const appUrl = baseUrl ?? env.appUrl ?? "http://localhost:3000";
    const redirectUri = `${appUrl}/api/auth/${config.serviceId}/callback`;

    try {
      const { url, state } = await service.createAuthorizationUrl({ ...authOptions, redirectUri });

      await tokenStore.setState(state);

      return dntShim.Response.redirect(url);
    } catch (error) {
      logger.error("[OAuth] Init error", { serviceId: config.serviceId }, error);

      return dntShim.Response.json(
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
): () => Promise<dntShim.Response> {
  const tokenStore = options.tokenStore ?? memoryTokenStore;
  const envReader = options.envReader ?? getEnv;

  return async function handler(): Promise<dntShim.Response> {
    const tokens = await tokenStore.getTokens(config.serviceId);

    const isConnected = !!tokens?.accessToken;
    const isExpired = tokens?.expiresAt ? Date.now() > tokens.expiresAt : false;
    const hasRefreshToken = !!tokens?.refreshToken;

    return dntShim.Response.json({
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
): () => Promise<dntShim.Response> {
  const tokenStore = options.tokenStore ?? memoryTokenStore;

  return async function handler(): Promise<dntShim.Response> {
    await tokenStore.clearTokens(config.serviceId);

    return dntShim.Response.json({
      success: true,
      message: `Disconnected from ${config.displayName}`,
    });
  };
}
