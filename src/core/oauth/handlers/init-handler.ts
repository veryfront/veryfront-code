/**
 * OAuth Init Handler
 *
 * Reusable handler for initiating OAuth flows.
 */

import { OAuthService } from "../providers/base.ts";
import type { AuthorizationUrlOptions, OAuthServiceConfig, TokenStore } from "../types.ts";
import { memoryTokenStore } from "../token-store/memory.ts";
import { getEnv } from "../../../platform/compat/process.ts";

export interface OAuthInitHandlerOptions {
  /** Token store to use (defaults to memory store) */
  tokenStore?: TokenStore;

  /** Base URL for callbacks (defaults to APP_URL or localhost) */
  baseUrl?: string;

  /** Additional authorization options */
  authOptions?: AuthorizationUrlOptions;
}

/**
 * Create an OAuth init route handler
 *
 * @example
 * ```typescript
 * // app/api/auth/gmail/route.ts
 * import { createOAuthInitHandler } from "veryfront/oauth";
 * import { gmailConfig } from "veryfront/oauth/providers";
 *
 * export const GET = createOAuthInitHandler(gmailConfig);
 * ```
 */
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

      // Store state for CSRF protection
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

/**
 * Create an OAuth status check handler
 *
 * @example
 * ```typescript
 * // app/api/auth/gmail/status/route.ts
 * import { createOAuthStatusHandler } from "veryfront/oauth";
 * import { gmailConfig } from "veryfront/oauth/providers";
 *
 * export const GET = createOAuthStatusHandler(gmailConfig);
 * ```
 */
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

/**
 * Create an OAuth disconnect handler
 *
 * @example
 * ```typescript
 * // app/api/auth/gmail/route.ts
 * import { createOAuthDisconnectHandler } from "veryfront/oauth";
 * import { gmailConfig } from "veryfront/oauth/providers";
 *
 * export const DELETE = createOAuthDisconnectHandler(gmailConfig);
 * ```
 */
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
