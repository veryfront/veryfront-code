import { logger as baseLogger } from "#veryfront/utils";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import {
  type EnvironmentConfig,
  getEnvironmentConfig,
} from "#veryfront/config/environment-config.ts";
import { type EnvReader, OAuthService } from "../providers/base.ts";
import type { OAuthServiceConfig, OAuthTokens, TokenStore } from "../types.ts";
import {
  MAX_OAUTH_STATE_KEY_LENGTH,
  type NormalizedStoredOAuthState,
  normalizeStoredOAuthStateForStorage,
} from "../state-utils.ts";
import {
  MAX_OAUTH_AUTHORIZATION_CODE_LENGTH,
  MAX_OAUTH_ERROR_DESCRIPTION_LENGTH,
  MAX_OAUTH_ERROR_LENGTH,
} from "../limits.ts";
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

/** Options accepted by a shared OAuth callback dispatcher. */
export interface OAuthCallbackDispatcherOptions extends OAuthCallbackHandlerOptions {
  /**
   * Physical callback route shared by every allowlisted service.
   *
   * Init handlers for these services must receive the same `callbackRouteId`.
   */
  callbackRouteId: string;
}

interface OAuthCallbackParameters {
  code: string | null;
  state: string | null;
  providerError: string | null;
}

interface OAuthCallbackParameterResult {
  parameters: OAuthCallbackParameters | null;
  reason?: "ambiguous" | "oversized";
}

interface OAuthCallbackRuntimeOptions {
  tokenStore: TokenStore;
  expectedRedirectUri: string;
  successUrl: URL;
  errorUrl: URL;
  onSuccess?: OAuthCallbackHandlerOptions["onSuccess"];
  onError?: OAuthCallbackHandlerOptions["onError"];
  defaultErrorServiceId?: string;
  selectService: (state: NormalizedStoredOAuthState) => OAuthService | null;
}

const CALLBACK_PARAMETER_LIMITS = {
  code: MAX_OAUTH_AUTHORIZATION_CODE_LENGTH,
  state: MAX_OAUTH_STATE_KEY_LENGTH,
  error: MAX_OAUTH_ERROR_LENGTH,
  error_description: MAX_OAUTH_ERROR_DESCRIPTION_LENGTH,
} as const;

function normalizeErrorCode(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length <= MAX_OAUTH_ERROR_LENGTH &&
      /^[A-Za-z0-9._~-]+$/.test(value)
    ? value
    : fallback;
}

function readOAuthCallbackParameters(url: URL): OAuthCallbackParameterResult {
  const values = new Map<keyof typeof CALLBACK_PARAMETER_LIMITS, string | null>();
  for (
    const [name, maximum] of Object.entries(CALLBACK_PARAMETER_LIMITS) as [
      keyof typeof CALLBACK_PARAMETER_LIMITS,
      number,
    ][]
  ) {
    const matches = url.searchParams.getAll(name);
    if (matches.length > 1) return { parameters: null, reason: "ambiguous" };
    const value = matches[0] ?? null;
    if (value !== null && value.length > maximum) {
      return { parameters: null, reason: "oversized" };
    }
    values.set(name, value);
  }

  const code = values.get("code") ?? null;
  const providerError = values.get("error") ?? null;
  if (code && providerError) return { parameters: null, reason: "ambiguous" };
  return {
    parameters: {
      code,
      state: values.get("state") ?? null,
      providerError,
    },
  };
}

function assertStateValidationEnabled(skipStateValidation: boolean): void {
  if (skipStateValidation) {
    throw new Error(
      "OAuth callback state validation cannot be disabled because it binds PKCE and user identity",
    );
  }
}

function createOAuthCallbackRuntime(
  options: OAuthCallbackRuntimeOptions,
): (request: Request) => Promise<Response> {
  const {
    tokenStore,
    expectedRedirectUri,
    successUrl,
    errorUrl,
    onSuccess,
    onError,
    defaultErrorServiceId,
    selectService,
  } = options;

  function redirectWithError(errorCode: string): Response {
    const target = new URL(errorUrl);
    target.searchParams.set("error", normalizeErrorCode(errorCode, "callback_error"));
    return createOAuthRedirect(target);
  }

  async function handleError(
    errorCode: string,
    serviceId: string | undefined,
    logMessage?: string,
    logData?: unknown,
  ): Promise<Response> {
    const normalizedCode = normalizeErrorCode(errorCode, "callback_error");
    if (logMessage) {
      logger.error(logMessage, {
        ...(serviceId === undefined ? {} : { serviceId }),
        data: logData,
      });
    }
    if (onError && serviceId !== undefined) {
      try {
        await onError(serviceId, normalizedCode);
      } catch (error) {
        logger.error("OAuth error callback failed", { serviceId }, error);
      }
    }
    return redirectWithError(normalizedCode);
  }

  return async function handler(request: Request): Promise<Response> {
    if (request.method !== "GET") {
      return createOAuthJsonResponse(
        { error: "Method not allowed" },
        { status: 405, headers: { Allow: "GET" } },
      );
    }

    const parsed = readOAuthCallbackParameters(new URL(request.url));
    if (!parsed.parameters) {
      return handleError(
        "invalid_request",
        defaultErrorServiceId,
        parsed.reason === "oversized"
          ? "Oversized OAuth callback parameter"
          : "Ambiguous OAuth callback parameters",
      );
    }
    const { code, state, providerError } = parsed.parameters;
    if (!state) {
      return handleError("invalid_state", defaultErrorServiceId, "Missing state parameter");
    }

    let consumedState: unknown;
    try {
      consumedState = await tokenStore.consumeState(state);
    } catch (error) {
      return handleError(
        "callback_error",
        defaultErrorServiceId,
        "OAuth state lookup failed",
        { error: error instanceof Error ? error.name : "Error" },
      );
    }

    const storedState = normalizeStoredOAuthStateForStorage(consumedState);
    const service = storedState ? selectService(storedState) : null;
    const stateHasRequiredPkce = service?.pkceMode === "unsupported"
      ? storedState?.codeVerifier === undefined
      : storedState?.codeVerifier !== undefined;
    if (
      !storedState || !service || storedState.redirectUri !== expectedRedirectUri ||
      !stateHasRequiredPkce
    ) {
      return handleError(
        "invalid_state",
        defaultErrorServiceId,
        "Invalid, expired, or mismatched state",
      );
    }
    const serviceId = service.serviceId;

    if (providerError) {
      const normalizedProviderError = normalizeErrorCode(providerError, "provider_error");
      logger.error("OAuth provider denied callback", {
        serviceId,
        error: normalizedProviderError,
      });
      return handleError(normalizedProviderError, serviceId);
    }

    if (!code) return handleError("no_code", serviceId);

    try {
      const result = await service.exchangeCode({
        code,
        redirectUri: storedState.redirectUri,
        codeVerifier: storedState.codeVerifier,
      });

      if (!result.success || !result.tokens) {
        return handleError(
          result.error ?? "token_exchange_failed",
          serviceId,
          "OAuth token exchange failed",
          { error: result.error },
        );
      }

      const tokens = {
        ...result.tokens,
        ...(result.tokens.scope === undefined && storedState.scopes.length > 0
          ? { scope: storedState.scopes.join(" ") }
          : {}),
      };
      await tokenStore.setTokens(serviceId, storedState.userId, { ...tokens });

      if (onSuccess) {
        try {
          await onSuccess(serviceId, { ...tokens }, storedState.userId);
        } catch (error) {
          logger.error("OAuth success callback failed", { serviceId }, error);
        }
      }

      const target = new URL(successUrl);
      target.searchParams.set("connected", serviceId);
      return createOAuthRedirect(target);
    } catch (error) {
      return handleError(
        "callback_error",
        serviceId,
        "OAuth callback failed",
        { error: error instanceof Error ? error.name : "Error" },
      );
    }
  };
}

/** Create a callback handler for one logical OAuth service. */
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

  assertStateValidationEnabled(skipStateValidation);
  const tokenStore = resolveOAuthHandlerTokenStore(configuredTokenStore, env);
  const service = new OAuthService(config, tokenStore, envReader);
  const appUrl = resolveOAuthApplicationUrl(baseUrl, env);

  return createOAuthCallbackRuntime({
    tokenStore,
    expectedRedirectUri: buildOAuthCallbackUrl(appUrl, service.serviceId),
    successUrl: resolveOAuthCompletionRedirect(appUrl, successRedirect),
    errorUrl: resolveOAuthCompletionRedirect(appUrl, errorRedirect),
    onSuccess,
    onError,
    defaultErrorServiceId: service.serviceId,
    selectService: (state) => state.serviceId === service.serviceId ? service : null,
  });
}

/**
 * Create one callback handler shared by a fixed allowlist of logical services.
 *
 * The consumed state selects a service only after generic state validation.
 * Configuration is snapshotted at construction and duplicate service IDs are
 * rejected so dispatch cannot depend on mutable array order.
 */
export function createOAuthCallbackDispatcher(
  configs: readonly OAuthServiceConfig[],
  options: OAuthCallbackDispatcherOptions,
): (request: Request) => Promise<Response> {
  if (!Array.isArray(configs) || configs.length === 0) {
    throw new Error("OAuth callback dispatcher requires at least one service config");
  }
  if (!options || typeof options.callbackRouteId !== "string" || !options.callbackRouteId) {
    throw new Error("OAuth callback dispatcher requires a nonempty callbackRouteId");
  }

  const {
    tokenStore: configuredTokenStore,
    callbackRouteId,
    baseUrl,
    successRedirect = "/",
    errorRedirect = "/",
    onSuccess,
    onError,
    skipStateValidation = false,
    env = getEnvironmentConfig(),
    envReader = getEnv,
  } = options;

  assertStateValidationEnabled(skipStateValidation);
  const tokenStore = resolveOAuthHandlerTokenStore(configuredTokenStore, env);
  const services = new Map<string, OAuthService>();
  for (const config of configs) {
    const service = new OAuthService(config, tokenStore, envReader);
    if (services.has(service.serviceId)) {
      throw new Error("OAuth callback dispatcher service IDs must be unique");
    }
    services.set(service.serviceId, service);
  }

  const appUrl = resolveOAuthApplicationUrl(baseUrl, env);
  return createOAuthCallbackRuntime({
    tokenStore,
    expectedRedirectUri: buildOAuthCallbackUrl(appUrl, callbackRouteId),
    successUrl: resolveOAuthCompletionRedirect(appUrl, successRedirect),
    errorUrl: resolveOAuthCompletionRedirect(appUrl, errorRedirect),
    onSuccess,
    onError,
    selectService: (state) => services.get(state.serviceId) ?? null,
  });
}
