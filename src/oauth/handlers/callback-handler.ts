import { logger as baseLogger } from "#veryfront/utils";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import {
  type EnvironmentConfig,
  getEnvironmentConfig,
} from "#veryfront/config/environment-config.ts";
import { type EnvReader, OAuthService } from "../providers/base.ts";
import { memoryTokenStore } from "../token-store/memory.ts";
import type { OAuthServiceConfig, StoredOAuthState, TokenStore } from "../types.ts";

const logger = baseLogger.component("o-auth");

/** Options accepted by oauth callback handler. */
export interface OAuthCallbackHandlerOptions {
  /** Token store to use (defaults to memory store) */
  tokenStore?: TokenStore;

  /** Base URL for redirects (defaults to APP_URL or localhost) */
  baseUrl?: string;

  /** Success redirect path */
  successRedirect?: string;

  /** Error redirect path */
  errorRedirect?: string;

  /** Custom success callback (called with the user ID the tokens were stored under) */
  onSuccess?: (serviceId: string, tokens: unknown, userId: string) => void | Promise<void>;

  /** Custom error callback */
  onError?: (serviceId: string, error: string) => void | Promise<void>;

  /** Skip state validation for providers that don't return state */
  skipStateValidation?: boolean;

  /** EnvironmentConfig for test isolation (defaults to getEnvironmentConfig()) */
  env?: EnvironmentConfig;

  /** EnvReader for dynamic env vars (defaults to getEnv) */
  envReader?: EnvReader;
}

/** Handler for create oauth callback. */
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
    skipStateValidation = false,
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
    const providerError = url.searchParams.get("error");
    const errorDescription = url.searchParams.get("error_description");

    const appUrl = getAppUrl();

    if (providerError) {
      logger.error("Callback error", {
        serviceId: config.serviceId,
        error: providerError,
        description: errorDescription,
      });
      await onError?.(config.serviceId, providerError);
      return redirectWithError(appUrl, providerError, errorDescription);
    }

    if (!code) return handleError(appUrl, "no_code");

    let storedState: StoredOAuthState | null = null;

    if (!skipStateValidation && !state) {
      return handleError(appUrl, "invalid_state", "Missing state parameter", {
        serviceId: config.serviceId,
      });
    }

    if (state) {
      // Atomic read+delete. Unknown/expired/forged state all return null.
      storedState = await tokenStore.consumeState(state);
      if (!skipStateValidation && !storedState) {
        return handleError(appUrl, "invalid_state", "Invalid or expired state", {
          serviceId: config.serviceId,
        });
      }
      // A state record from a different service must never authorize this one.
      if (storedState && storedState.serviceId !== config.serviceId) {
        return handleError(appUrl, "invalid_state", "State serviceId mismatch", {
          serviceId: config.serviceId,
          stateServiceId: storedState.serviceId,
        });
      }
    }

    const service = new OAuthService(config, tokenStore, envReader);
    const redirectUri = `${appUrl}/api/auth/${config.serviceId}/callback`;

    try {
      const result = await service.exchangeCode({
        code,
        redirectUri,
        codeVerifier: storedState?.codeVerifier,
      });

      if (!result.success || !result.tokens) {
        return handleError(
          appUrl,
          result.error ?? "token_exchange_failed",
          `Token exchange failed for ${config.serviceId}:`,
          result.error,
        );
      }

      // Without state (skipStateValidation) we have no userId — refuse to
      // store tokens under a shared slot. Callers who need this path must
      // provide a store that handles it themselves (e.g. cookie-scoped).
      if (!storedState) {
        return handleError(
          appUrl,
          "invalid_state",
          `Cannot store tokens for ${config.serviceId}: no state (and thus no userId) available`,
        );
      }

      await tokenStore.setTokens(config.serviceId, storedState.userId, result.tokens);

      await onSuccess?.(config.serviceId, result.tokens, storedState.userId);

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
