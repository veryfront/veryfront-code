import { logger as baseLogger } from "#veryfront/utils";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import {
  type EnvironmentConfig,
  getEnvironmentConfig,
} from "#veryfront/config/environment-config.ts";
import { type EnvReader, OAuthService } from "../providers/base.ts";
import type { OAuthServiceConfig, OAuthTokens, StoredOAuthState, TokenStore } from "../types.ts";
import { normalizeStoredOAuthState } from "../state-utils.ts";
import { MAX_OAUTH_STATE_KEY_LENGTH } from "../state-utils.ts";
import { MAX_OAUTH_AUTHORIZATION_CODE_LENGTH } from "../limits.ts";
import {
  buildOAuthCallbackUrl,
  createOAuthJsonResponse,
  createOAuthRedirect,
  resolveOAuthApplicationUrl,
  resolveOAuthCompletionRedirect,
} from "../url-utils.ts";
import { resolveOAuthHandlerTokenStore } from "./token-store-policy.ts";

const logger = baseLogger.component("o-auth");

/** Options accepted by oauth callback handler. */
export interface OAuthCallbackHandlerOptions {
  /** Shared token store. Optional only in explicit development/test environments. */
  tokenStore?: TokenStore;

  /** Base URL for redirects (defaults to APP_URL or localhost) */
  baseUrl?: string;

  /** Success redirect path */
  successRedirect?: string;

  /** Error redirect path */
  errorRedirect?: string;

  /**
   * Post-commit success notification. Failures are logged without changing the
   * completed OAuth result. Receives a detached token snapshot.
   */
  onSuccess?: (serviceId: string, tokens: OAuthTokens, userId: string) => void | Promise<void>;

  /** Custom error callback */
  onError?: (serviceId: string, error: string) => void | Promise<void>;

  /** @deprecated State validation cannot be disabled; `true` is rejected. */
  skipStateValidation?: boolean;

  /**
   * @deprecated Callback identity is always recovered from the one-shot state
   * row. This option is retained only for source compatibility and is ignored.
   */
  getUserId?: (request: Request) => string | null | Promise<string | null>;

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
    tokenStore: configuredTokenStore,
    baseUrl,
    successRedirect = "/",
    errorRedirect = "/",
    onSuccess,
    onError,
    skipStateValidation = false,
    env = getEnvironmentConfig(),
    envReader = getEnv,
  } = options;

  if (skipStateValidation) {
    throw new Error(
      "OAuth callback state validation cannot be disabled because it binds PKCE and user identity",
    );
  }
  const tokenStore = resolveOAuthHandlerTokenStore(configuredTokenStore, env);
  const service = new OAuthService(config, tokenStore, envReader);

  const appUrl = resolveOAuthApplicationUrl(baseUrl, env);
  const expectedRedirectUri = buildOAuthCallbackUrl(appUrl, service.serviceId);
  const successUrl = resolveOAuthCompletionRedirect(appUrl, successRedirect);
  const errorUrl = resolveOAuthCompletionRedirect(appUrl, errorRedirect);

  function normalizeErrorCode(value: unknown, fallback: string): string {
    return typeof value === "string" && /^[A-Za-z0-9._~-]{1,128}$/.test(value) ? value : fallback;
  }

  function redirectWithError(
    errorCode: string,
  ): Response {
    const target = new URL(errorUrl);
    target.searchParams.set("error", normalizeErrorCode(errorCode, "callback_error"));
    return createOAuthRedirect(target);
  }

  async function handleError(
    errorCode: string,
    logMessage?: string,
    logData?: unknown,
  ): Promise<Response> {
    const normalizedCode = normalizeErrorCode(errorCode, "callback_error");
    if (logMessage) logger.error(logMessage, { data: logData });
    if (onError) {
      try {
        await onError(service.serviceId, normalizedCode);
      } catch (error) {
        logger.error("OAuth error callback failed", { serviceId: service.serviceId }, error);
      }
    }
    return redirectWithError(normalizedCode);
  }

  function readSingleParameter(url: URL, name: string): string | null | undefined {
    const values = url.searchParams.getAll(name);
    return values.length > 1 ? undefined : values[0] ?? null;
  }

  return async function handler(request: Request): Promise<Response> {
    if (request.method !== "GET") {
      return createOAuthJsonResponse(
        { error: "Method not allowed" },
        { status: 405, headers: { Allow: "GET" } },
      );
    }
    const url = new URL(request.url);
    const code = readSingleParameter(url, "code");
    const state = readSingleParameter(url, "state");
    const providerError = readSingleParameter(url, "error");
    const errorDescription = readSingleParameter(url, "error_description");
    if (
      code === undefined || state === undefined || providerError === undefined ||
      errorDescription === undefined || (code && providerError)
    ) {
      return handleError("invalid_request", "Ambiguous OAuth callback parameters", {
        serviceId: service.serviceId,
      });
    }

    if (
      (state !== null && state.length > MAX_OAUTH_STATE_KEY_LENGTH) ||
      (code !== null && code.length > MAX_OAUTH_AUTHORIZATION_CODE_LENGTH)
    ) {
      return handleError("invalid_request", "Oversized OAuth callback parameter", {
        serviceId: service.serviceId,
      });
    }

    let storedState: StoredOAuthState | null = null;

    if (!state) {
      return handleError("invalid_state", "Missing state parameter", {
        serviceId: service.serviceId,
      });
    }

    if (state) {
      let consumedState: unknown;
      try {
        consumedState = await tokenStore.consumeState(state);
      } catch (error) {
        return handleError("callback_error", "OAuth state lookup failed", {
          serviceId: service.serviceId,
          error: error instanceof Error ? error.name : "Error",
        });
      }
      storedState = normalizeStoredOAuthState(
        consumedState,
        service.serviceId,
        expectedRedirectUri,
        Date.now(),
        service.pkceMode !== "unsupported",
      );
      if (!storedState) {
        return handleError("invalid_state", "Invalid, expired, or mismatched state", {
          serviceId: service.serviceId,
        });
      }
    }

    if (providerError) {
      logger.error("OAuth provider denied callback", {
        serviceId: service.serviceId,
        error: normalizeErrorCode(providerError, "provider_error"),
      });
      return handleError(normalizeErrorCode(providerError, "provider_error"));
    }

    if (!code) return handleError("no_code");

    const userId = storedState?.userId;
    if (!userId) {
      return handleError(
        "user_binding_required",
        `Cannot store tokens for ${service.serviceId}: no authenticated user binding is available`,
      );
    }

    try {
      const result = await service.exchangeCode({
        code,
        redirectUri: storedState?.redirectUri ?? expectedRedirectUri,
        codeVerifier: storedState?.codeVerifier,
      });

      if (!result.success || !result.tokens) {
        return handleError(
          result.error ?? "token_exchange_failed",
          `Token exchange failed for ${service.serviceId}:`,
          result.error,
        );
      }

      const tokens = { ...result.tokens };
      await tokenStore.setTokens(service.serviceId, userId, { ...tokens });

      if (onSuccess) {
        try {
          await onSuccess(service.serviceId, { ...tokens }, userId);
        } catch (error) {
          logger.error("OAuth success callback failed", { serviceId: service.serviceId }, error);
        }
      }

      const target = new URL(successUrl);
      target.searchParams.set("connected", service.serviceId);
      return createOAuthRedirect(target);
    } catch (error) {
      return handleError(
        "callback_error",
        `OAuth callback error for ${service.serviceId}:`,
        error,
      );
    }
  };
}
