/**
 * OAuth Callback Handler
 *
 * Reusable handler for OAuth callback routes.
 */

import { OAuthService } from "../providers/base.ts";
import type { OAuthServiceConfig, TokenStore } from "../types.ts";
import { memoryTokenStore } from "../token-store/memory.ts";
import { getEnv } from "../../../platform/compat/process.ts";

export interface OAuthCallbackHandlerOptions {
  /** Token store to use (defaults to memory store) */
  tokenStore?: TokenStore;

  /** Base URL for redirects (defaults to APP_URL or localhost) */
  baseUrl?: string;

  /** Success redirect path */
  successRedirect?: string;

  /** Error redirect path */
  errorRedirect?: string;

  /** Custom success callback */
  onSuccess?: (serviceId: string, tokens: unknown) => void | Promise<void>;

  /** Custom error callback */
  onError?: (serviceId: string, error: string) => void | Promise<void>;
}

/**
 * Create an OAuth callback route handler
 *
 * @example
 * ```typescript
 * // app/api/auth/gmail/callback/route.ts
 * import { createOAuthCallbackHandler } from "veryfront/oauth";
 * import { gmailConfig } from "veryfront/oauth/providers";
 *
 * export const GET = createOAuthCallbackHandler(gmailConfig);
 * ```
 */
export function createOAuthCallbackHandler(
  config: OAuthServiceConfig,
  options: OAuthCallbackHandlerOptions = {},
): (request: Request) => Promise<Response> {
  const {
    tokenStore = memoryTokenStore,
    baseUrl,
    successRedirect = "/",
    errorRedirect = "/",
    onSuccess,
    onError,
  } = options;

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");
    const errorDescription = url.searchParams.get("error_description");

    const appUrl = baseUrl ||
      getEnv("APP_URL") ||
      getEnv("NEXT_PUBLIC_APP_URL") ||
      "http://localhost:3000";

    // Handle OAuth errors
    if (error) {
      console.error(`OAuth error for ${config.serviceId}:`, error, errorDescription);
      if (onError) {
        await onError(config.serviceId, error);
      }
      const errorUrl = new URL(errorRedirect, appUrl);
      errorUrl.searchParams.set("error", error);
      if (errorDescription) {
        errorUrl.searchParams.set("error_description", errorDescription);
      }
      return Response.redirect(errorUrl.toString());
    }

    // Validate code
    if (!code) {
      if (onError) {
        await onError(config.serviceId, "no_code");
      }
      const errorUrl = new URL(errorRedirect, appUrl);
      errorUrl.searchParams.set("error", "no_code");
      return Response.redirect(errorUrl.toString());
    }

    // Validate and retrieve state
    let oauthState = null;
    if (state) {
      oauthState = await tokenStore.getState(state);
      if (!oauthState) {
        console.warn(`Invalid or expired state for ${config.serviceId}`);
        // Continue anyway - some providers don't properly return state
      }
    }

    const service = new OAuthService(config, tokenStore);
    const redirectUri = `${appUrl}/api/auth/${config.serviceId}/callback`;

    try {
      const result = await service.exchangeCode({
        code,
        redirectUri,
        codeVerifier: oauthState?.codeVerifier,
      });

      if (!result.success || !result.tokens) {
        console.error(`Token exchange failed for ${config.serviceId}:`, result.error);
        if (onError) {
          await onError(config.serviceId, result.error || "exchange_failed");
        }
        const errorUrl = new URL(errorRedirect, appUrl);
        errorUrl.searchParams.set("error", result.error || "token_exchange_failed");
        return Response.redirect(errorUrl.toString());
      }

      // Store tokens
      await tokenStore.setTokens(config.serviceId, result.tokens);

      // Clear state
      if (state) {
        await tokenStore.clearState(state);
      }

      // Call success callback
      if (onSuccess) {
        await onSuccess(config.serviceId, result.tokens);
      }

      // Redirect to success URL
      const successUrl = new URL(successRedirect, appUrl);
      successUrl.searchParams.set("connected", config.serviceId);
      return Response.redirect(successUrl.toString());
    } catch (err) {
      console.error(`OAuth callback error for ${config.serviceId}:`, err);
      if (onError) {
        await onError(config.serviceId, "callback_error");
      }
      const errorUrl = new URL(errorRedirect, appUrl);
      errorUrl.searchParams.set("error", "callback_error");
      return Response.redirect(errorUrl.toString());
    }
  };
}
