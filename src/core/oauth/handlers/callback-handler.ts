
import { OAuthService } from "../providers/base.ts";
import type { OAuthServiceConfig, TokenStore } from "../types.ts";
import { memoryTokenStore } from "../token-store/memory.ts";
import { getEnv } from "../../../platform/compat/process.ts";

export interface OAuthCallbackHandlerOptions {
  tokenStore?: TokenStore;

  baseUrl?: string;

  successRedirect?: string;

  errorRedirect?: string;

  onSuccess?: (serviceId: string, tokens: unknown) => void | Promise<void>;

  onError?: (serviceId: string, error: string) => void | Promise<void>;
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

    if (!code) {
      if (onError) {
        await onError(config.serviceId, "no_code");
      }
      const errorUrl = new URL(errorRedirect, appUrl);
      errorUrl.searchParams.set("error", "no_code");
      return Response.redirect(errorUrl.toString());
    }

    let oauthState = null;
    if (state) {
      oauthState = await tokenStore.getState(state);
      if (!oauthState) {
        console.warn(`Invalid or expired state for ${config.serviceId}`);
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

      await tokenStore.setTokens(config.serviceId, result.tokens);

      if (state) {
        await tokenStore.clearState(state);
      }

      if (onSuccess) {
        await onSuccess(config.serviceId, result.tokens);
      }

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
