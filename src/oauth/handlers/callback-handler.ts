import { logger as baseLogger } from "#veryfront/utils";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import {
  type EnvironmentConfig,
  getEnvironmentConfig,
} from "#veryfront/config/environment-config.ts";
import { type EnvReader, OAuthService } from "../providers/base.ts";
import { memoryTokenStore } from "../token-store/memory.ts";
import type { OAuthServiceConfig, OAuthTokens, StoredOAuthState, TokenStore } from "../types.ts";
import {
  isSecureHttpUrl,
  OAUTH_STATE_CLOCK_SKEW_MS,
  OAUTH_STATE_EXPIRY_MS,
} from "../validation.ts";
import {
  assertApplicationRedirectPath,
  createNoStoreJson,
  createNoStoreRedirect,
  createOAuthCallbackUri,
  getErrorName,
  normalizeOAuthErrorCode,
  resolveApplicationRedirect,
  resolveOAuthAppUrl,
} from "./http-utils.ts";

const logger = baseLogger.component("o-auth");
const MAX_CALLBACK_STATE_LENGTH = 4_096;
const MAX_AUTHORIZATION_CODE_LENGTH = 16_384;
const MAX_USER_ID_LENGTH = 4_096;
const MAX_REDIRECT_URI_LENGTH = 4_096;

function isValidStoredState(state: StoredOAuthState, serviceId: string): boolean {
  const now = Date.now();
  return typeof state.userId === "string" && state.userId.trim().length > 0 &&
    state.userId.length <= MAX_USER_ID_LENGTH &&
    typeof state.serviceId === "string" && state.serviceId === serviceId &&
    Number.isSafeInteger(state.createdAt) && state.createdAt >= 0 &&
    state.createdAt <= now + OAUTH_STATE_CLOCK_SKEW_MS &&
    now - state.createdAt <= OAUTH_STATE_EXPIRY_MS &&
    (state.redirectUri === undefined ||
      (typeof state.redirectUri === "string" &&
        state.redirectUri.length <= MAX_REDIRECT_URI_LENGTH &&
        isSecureHttpUrl(state.redirectUri))) &&
    (state.codeVerifier === undefined ||
      (typeof state.codeVerifier === "string" && state.codeVerifier.length >= 43 &&
        state.codeVerifier.length <= 128 && /^[A-Za-z0-9._~-]+$/.test(state.codeVerifier)));
}

/** Options for {@link createOAuthCallbackHandler}. */
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
  onSuccess?: (serviceId: string, tokens: OAuthTokens, userId: string) => void | Promise<void>;

  /** Custom error callback */
  onError?: (serviceId: string, error: string) => void | Promise<void>;

  /**
   * @deprecated OAuth callbacks always validate state. Providers must return
   * the state value supplied in the authorization request.
   */
  skipStateValidation?: boolean;

  /** EnvironmentConfig for test isolation (defaults to getEnvironmentConfig()) */
  env?: EnvironmentConfig;

  /** EnvReader for dynamic env vars (defaults to getEnv) */
  envReader?: EnvReader;
}

/**
 * Create an OAuth callback handler that consumes one-time state, exchanges the
 * authorization code, and stores tokens in the initiating user's slot.
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
    env = getEnvironmentConfig(),
    envReader = getEnv,
  } = options;
  const service = new OAuthService(config, tokenStore, envReader);
  const serviceId = service.serviceId;

  assertApplicationRedirectPath(successRedirect, "successRedirect");
  assertApplicationRedirectPath(errorRedirect, "errorRedirect");

  function getAppUrl(): string {
    return resolveOAuthAppUrl(baseUrl, env);
  }

  function redirectWithError(
    appUrl: string,
    errorCode: string,
  ): Response {
    const errorUrl = resolveApplicationRedirect(appUrl, errorRedirect);
    errorUrl.searchParams.set("error", errorCode);
    return createNoStoreRedirect(errorUrl);
  }

  async function handleError(
    appUrl: string,
    errorCode: string,
    logMessage?: string,
  ): Promise<Response> {
    if (logMessage) {
      logger.error(logMessage, { serviceId, errorCode });
    }
    try {
      await onError?.(serviceId, errorCode);
    } catch (error) {
      logger.error("OAuth error callback failed", {
        serviceId,
        errorName: getErrorName(error),
      });
    }
    return redirectWithError(appUrl, errorCode);
  }

  return async function handler(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const providerError = url.searchParams.get("error");
    let appUrl: string;
    try {
      appUrl = getAppUrl();
    } catch (error) {
      logger.error("OAuth callback configuration failed", {
        serviceId,
        errorName: getErrorName(error),
      });
      return createNoStoreJson({ error: "OAuth callback failed" }, 500);
    }

    let storedState: StoredOAuthState | null = null;

    if (!state) {
      return handleError(appUrl, "invalid_state", "Missing state parameter");
    }
    if (state.length > MAX_CALLBACK_STATE_LENGTH) {
      return handleError(appUrl, "invalid_state", "OAuth state exceeded the limit");
    }

    try {
      // Atomic read+delete. Unknown/expired/forged state all return null.
      storedState = await tokenStore.consumeState(state);
      if (!storedState) {
        return handleError(appUrl, "invalid_state", "Invalid or expired state");
      }
      // A stale, malformed, or differently scoped state record must never
      // authorize this callback, even if a custom store returned it.
      if (!isValidStoredState(storedState, serviceId)) {
        return handleError(appUrl, "invalid_state", "State binding mismatch");
      }
    } catch (error) {
      logger.error("OAuth state lookup failed", {
        serviceId,
        errorName: getErrorName(error),
      });
      return handleError(appUrl, "callback_error");
    }

    if (providerError) {
      const errorCode = normalizeOAuthErrorCode(providerError);
      logger.error("OAuth provider denied callback", {
        serviceId,
        errorCode,
      });
      return handleError(appUrl, errorCode);
    }

    if (!code) return handleError(appUrl, "no_code");
    if (code.length > MAX_AUTHORIZATION_CODE_LENGTH) {
      return handleError(appUrl, "invalid_request", "OAuth code exceeded the limit");
    }

    const redirectUri = createOAuthCallbackUri(appUrl, serviceId);

    try {
      const result = await service.exchangeCode({
        code,
        redirectUri: storedState.redirectUri ?? redirectUri,
        codeVerifier: storedState.codeVerifier,
      });

      if (!result.success || !result.tokens) {
        return handleError(
          appUrl,
          normalizeOAuthErrorCode(result.error ?? "token_exchange_failed"),
          "OAuth token exchange failed",
        );
      }

      await tokenStore.setTokens(serviceId, storedState.userId, { ...result.tokens });

      try {
        await onSuccess?.(serviceId, { ...result.tokens }, storedState.userId);
      } catch (error) {
        logger.error("OAuth success callback failed", {
          serviceId,
          errorName: getErrorName(error),
        });
      }

      const successUrl = resolveApplicationRedirect(appUrl, successRedirect);
      successUrl.searchParams.set("connected", serviceId);
      return createNoStoreRedirect(successUrl);
    } catch (error) {
      logger.error("OAuth callback request failed", {
        serviceId,
        errorName: getErrorName(error),
      });
      return handleError(
        appUrl,
        "callback_error",
      );
    }
  };
}
