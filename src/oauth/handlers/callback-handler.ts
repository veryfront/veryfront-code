/**************************************************
 * OAuth Callback Handler
 *
 * Reusable handler for OAuth callback routes.
 **************************************************/

import { logger } from "#veryfront/utils";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import { getEnvironmentConfig, type EnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { type EnvReader, OAuthService } from "../providers/base.ts";
import { memoryTokenStore } from "../token-store/memory.ts";
import type { OAuthServiceConfig, TokenStore } from "../types.ts";

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

  /** EnvironmentConfig for test isolation (defaults to getEnvironmentConfig()) */
  env?: EnvironmentConfig;

  /** EnvReader for dynamic env vars (defaults to getEnv) */
  envReader?: EnvReader;
}

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
    env = getEnvironmentConfig(),
    envReader = getEnv,
  } = options;

  function getAppUrl(): string {
    return baseUrl ?? env.appUrl ?? "http://localhost:3000";
  }

  function redirectWithError(
    appUrl: string,
    errorCode: string,
    description?: string | null,
  ): Response {
    const errorUrl = new URL(errorRedirect, appUrl);
    errorUrl.searchParams.set("error", errorCode);
    if (description) errorUrl.searchParams.set("error_description", description);
    return Response.redirect(errorUrl.toString());
  }

  async function handleError(
    appUrl: string,
    errorCode: string,
    logMessage?: string,
    logData?: unknown,
  ): Promise<Response> {
    if (logMessage) logger.error(logMessage, { data: logData });
    await onError?.(config.serviceId, errorCode);
    return redirectWithError(appUrl, errorCode);
  }

  return async function handler(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const oauthError = url.searchParams.get("error");
    const errorDescription = url.searchParams.get("error_description");

    const appUrl = getAppUrl();

    if (oauthError) {
      logger.error("[OAuth] Callback error", {
        serviceId: config.serviceId,
        error: oauthError,
        description: errorDescription,
      });
      await onError?.(config.serviceId, oauthError);
      return redirectWithError(appUrl, oauthError, errorDescription);
    }

    if (!code) return handleError(appUrl, "no_code");

    let oauthState: Awaited<ReturnType<TokenStore["getState"]>> | null = null;
    if (state) {
      oauthState = await tokenStore.getState(state);
      if (!oauthState) {
        logger.warn("[OAuth] Invalid or expired state", { serviceId: config.serviceId });
        // Continue anyway - some providers don't properly return state
      }
    }

    const service = new OAuthService(config, tokenStore, envReader);
    const redirectUri = `${appUrl}/api/auth/${config.serviceId}/callback`;

    try {
      const result = await service.exchangeCode({
        code,
        redirectUri,
        codeVerifier: oauthState?.codeVerifier,
      });

      if (!result.success || !result.tokens) {
        return handleError(
          appUrl,
          result.error ?? "token_exchange_failed",
          `Token exchange failed for ${config.serviceId}:`,
          result.error,
        );
      }

      await tokenStore.setTokens(config.serviceId, result.tokens);

      if (state) await tokenStore.clearState(state);

      await onSuccess?.(config.serviceId, result.tokens);

      const successUrl = new URL(successRedirect, appUrl);
      successUrl.searchParams.set("connected", config.serviceId);
      return Response.redirect(successUrl.toString());
    } catch (error) {
      return handleError(
        appUrl,
        "callback_error",
        `OAuth callback error for ${config.serviceId}:`,
        error,
      );
    }
  };
}
