import { logger as baseLogger } from "#veryfront/utils";
import {
  type EnvironmentConfig,
  getEnvironmentConfig,
} from "#veryfront/config/environment-config.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import { type EnvReader, OAuthService } from "../providers/base.ts";
import type { AuthorizationUrlOptions, OAuthServiceConfig, TokenStore } from "../types.ts";
import {
  buildOAuthCallbackUrl,
  createOAuthJsonResponse,
  createOAuthRedirect,
  resolveOAuthApplicationUrl,
} from "../url-utils.ts";
import { isRefreshCapableTokenStore, normalizeStoredOAuthTokens } from "../token-utils.ts";
import { normalizeOAuthUserId } from "../state-utils.ts";
import { normalizeOAuthScopeSet } from "../scope-utils.ts";
import {
  getOAuthParameterRecordIssues,
  RESERVED_AUTHORIZATION_PARAMETERS,
} from "../config-validation.ts";
import { resolveOAuthHandlerTokenStore } from "./token-store-policy.ts";

const logger = baseLogger.component("o-auth");
function createUnauthorizedResponse(): Response {
  return createOAuthJsonResponse({ error: "Unauthorized" }, { status: 401 });
}

function createMethodNotAllowedResponse(allow: "GET" | "POST"): Response {
  return createOAuthJsonResponse(
    { error: "Method not allowed" },
    { status: 405, headers: { Allow: allow } },
  );
}

function createForbiddenResponse(): Response {
  return createOAuthJsonResponse({ error: "Forbidden" }, { status: 403 });
}

async function isRequestUnauthorized(
  req: Request,
  isAuthenticated?: (req: Request) => boolean | Promise<boolean>,
): Promise<boolean> {
  return isAuthenticated ? !(await isAuthenticated(req)) : false;
}

/**
 * Resolve the userId for a request, returning null when anonymous.
 *
 * `getUserId` is required at compile time (see handler option types). We
 * still tolerate `undefined` at runtime (e.g. a JS caller) and treat it as
 * unauthenticated — NEVER fall back to "anonymous": that preserves
 * VULN-AUTH-2 where unrelated users share a single token slot.
 */
async function resolveUserId(
  req: Request,
  getUserId: GetUserIdFn | undefined,
): Promise<string | null> {
  if (!getUserId) return null;
  const result = await getUserId(req);
  const normalized = normalizeOAuthUserId(result);
  return normalized !== null && normalized === result ? normalized : null;
}

function createNotConfiguredResponse(service: OAuthService): Response {
  // SEC-009: Do NOT leak internal env var names in the HTTP response body.
  // Operators still need the diagnostic, so log the missing env var names
  // server-side via the existing logger.
  logger.error("OAuth provider not configured", {
    serviceId: service.serviceId,
    displayName: service.displayName,
    missingVars: service.credentialEnvironmentVariables,
  });
  return createOAuthJsonResponse(
    { error: `${service.displayName} OAuth not configured` },
    { status: 503 },
  );
}

function createInitErrorResponse(): Response {
  // SEC-009: do NOT leak internal error details (file paths, library
  // internals) to the client. The caller already logs the full error
  // server-side; return a generic message here.
  return createOAuthJsonResponse(
    { error: "Failed to initiate OAuth flow" },
    { status: 500 },
  );
}

/** Signature for resolving the authenticated user's ID from a request. */
export type GetUserIdFn = (req: Request) => string | null | Promise<string | null>;

/** Options accepted by oauth init handler. */
export interface OAuthInitHandlerOptions {
  /** Shared token store. Optional only in explicit development/test environments. */
  tokenStore?: TokenStore;

  /** Base URL for callbacks (defaults to APP_URL or localhost) */
  baseUrl?: string;

  /** Additional authorization options */
  authOptions?: AuthorizationUrlOptions;

  /** EnvironmentConfig for test isolation (defaults to getEnvironmentConfig()) */
  env?: EnvironmentConfig;

  /** EnvReader for dynamic env vars (defaults to getEnv) */
  envReader?: EnvReader;

  /**
   * Optional authentication check. If supplied and returns false the request
   * is rejected with 401. Independent from `getUserId` which always runs.
   */
  isAuthenticated?: (req: Request) => boolean | Promise<boolean>;

  /**
   * REQUIRED. Resolve the authenticated user's id. The returned id is
   * persisted with the OAuth `state` so the callback stores tokens in that
   * user's slot. Return `null` (or an empty string) to reject unauthenticated
   * requests with 401. NEVER return a shared constant like "anonymous" —
   * that re-introduces VULN-AUTH-2.
   */
  getUserId: GetUserIdFn;
}

/** Handler for create oauth init. */
export function createOAuthInitHandler(
  config: OAuthServiceConfig,
  options: OAuthInitHandlerOptions,
): (req: Request) => Promise<Response> {
  const {
    tokenStore: configuredTokenStore,
    baseUrl,
    authOptions = {},
    env = getEnvironmentConfig(),
    envReader = getEnv,
    isAuthenticated,
    getUserId,
  } = options ?? ({} as OAuthInitHandlerOptions);
  const tokenStore = resolveOAuthHandlerTokenStore(configuredTokenStore, env);
  const service = new OAuthService(config, tokenStore, envReader);
  const handlerUsesPkce = service.pkceMode !== "unsupported";

  if (authOptions.state !== undefined) {
    throw new Error(
      "OAuth init handler state is generated internally and must not be configured through authOptions",
    );
  }
  if (authOptions.redirectUri !== undefined) {
    throw new Error(
      "OAuth init handler redirectUri is derived from the configured application URL",
    );
  }
  const scopes = authOptions.scopes === undefined ? undefined : normalizeOAuthScopeSet(
    authOptions.scopes,
    config.scopeSeparator === "," ? "," : " ",
  );
  if (authOptions.scopes !== undefined && !scopes) {
    throw new Error("OAuth init handler scopes are invalid");
  }
  const additionalParamsIssue = getOAuthParameterRecordIssues(
    authOptions.additionalParams,
    RESERVED_AUTHORIZATION_PARAMETERS,
  )[0];
  if (additionalParamsIssue) {
    throw new Error(
      `Invalid OAuth authorization parameter configuration: ${additionalParamsIssue.message}`,
    );
  }
  if (authOptions.usePkce !== undefined && authOptions.usePkce !== handlerUsesPkce) {
    throw new Error(
      handlerUsesPkce
        ? "OAuth init handler requires PKCE with the S256 challenge method"
        : "OAuth provider does not support PKCE",
    );
  }
  const authorizationOptions: AuthorizationUrlOptions = {
    ...authOptions,
    ...(scopes ? { scopes } : {}),
    ...(authOptions.additionalParams !== undefined
      ? { additionalParams: { ...authOptions.additionalParams } }
      : {}),
    usePkce: handlerUsesPkce,
  };
  const appUrl = resolveOAuthApplicationUrl(baseUrl, env);
  const redirectUri = buildOAuthCallbackUrl(appUrl, service.serviceId);

  return async function handler(req: Request): Promise<Response> {
    if (req.method !== "GET") return createMethodNotAllowedResponse("GET");
    try {
      if (await isRequestUnauthorized(req, isAuthenticated)) {
        return createUnauthorizedResponse();
      }

      const userId = await resolveUserId(req, getUserId);
      if (!userId) return createUnauthorizedResponse();

      if (!service.isConfigured()) {
        return createNotConfiguredResponse(service);
      }

      const { url, state } = await service.createAuthorizationUrl({
        ...authorizationOptions,
        redirectUri,
      });
      if (handlerUsesPkce && !state.codeVerifier) {
        throw new Error("OAuth provider did not return the required PKCE verifier state");
      }
      await tokenStore.setState(state.state, {
        userId,
        serviceId: service.serviceId,
        redirectUri: state.redirectUri,
        scopes: state.scopes,
        createdAt: state.createdAt,
        ...(state.codeVerifier === undefined ? {} : { codeVerifier: state.codeVerifier }),
        metadata: state.metadata,
      });
      return createOAuthRedirect(url);
    } catch (error) {
      logger.error("Init error", { serviceId: service.serviceId }, error);
      return createInitErrorResponse();
    }
  };
}

export interface OAuthStatusHandlerOptions {
  /** Shared token store. Optional only in explicit development/test environments. */
  tokenStore?: TokenStore;

  /** EnvironmentConfig for store policy/test isolation. */
  env?: EnvironmentConfig;

  /** EnvReader for dynamic env vars (defaults to getEnv) */
  envReader?: EnvReader;

  /** Optional authentication check — return true if the request is authenticated */
  isAuthenticated?: (req: Request) => boolean | Promise<boolean>;

  /** REQUIRED. Resolve the authenticated user's ID (see OAuthInitHandlerOptions). */
  getUserId: GetUserIdFn;
}

/** Handler for create oauth status. */
export function createOAuthStatusHandler(
  config: OAuthServiceConfig,
  options: OAuthStatusHandlerOptions,
): (req: Request) => Promise<Response> {
  const {
    tokenStore: configuredTokenStore,
    env = getEnvironmentConfig(),
    envReader = getEnv,
    isAuthenticated,
    getUserId,
  } = options ?? ({} as OAuthStatusHandlerOptions);
  const tokenStore = resolveOAuthHandlerTokenStore(configuredTokenStore, env);
  const service = new OAuthService(config, tokenStore, envReader);

  return async function handler(req: Request): Promise<Response> {
    if (req.method !== "GET") return createMethodNotAllowedResponse("GET");
    try {
      if (await isRequestUnauthorized(req, isAuthenticated)) {
        return createUnauthorizedResponse();
      }

      const userId = await resolveUserId(req, getUserId);
      if (!userId) return createUnauthorizedResponse();

      const storedTokens = await tokenStore.getTokens(service.serviceId, userId);
      const tokens = storedTokens === null ? null : normalizeStoredOAuthTokens(storedTokens);
      if (storedTokens !== null && !tokens) {
        throw new Error("TokenStore returned an invalid OAuth token row");
      }
      const isConnected = !!tokens?.accessToken;
      const isExpired = tokens?.expiresAt !== undefined ? Date.now() >= tokens.expiresAt : false;
      const hasRefreshToken = !!tokens?.refreshToken;
      const refreshCapable = isRefreshCapableTokenStore(tokenStore);

      return createOAuthJsonResponse({
        service: service.serviceId,
        displayName: service.displayName,
        connected: isConnected && (!isExpired || (hasRefreshToken && refreshCapable)),
        configured: service.isConfigured(),
        expiresAt: tokens?.expiresAt,
        hasRefreshToken,
        refreshCapable,
      });
    } catch (error) {
      logger.error("OAuth status lookup failed", { serviceId: service.serviceId }, error);
      return createOAuthJsonResponse({ error: "Failed to read OAuth status" }, { status: 500 });
    }
  };
}

export interface OAuthDisconnectHandlerOptions {
  /** Shared token store. Optional only in explicit development/test environments. */
  tokenStore?: TokenStore;
  /** EnvironmentConfig for store policy/test isolation. */
  env?: EnvironmentConfig;
  /** Public application origin used for same-origin CSRF validation. */
  baseUrl?: string;
  /** Optional authentication check — return true if the request is authenticated */
  isAuthenticated?: (req: Request) => boolean | Promise<boolean>;
  /** REQUIRED. Resolve the authenticated user's ID (see OAuthInitHandlerOptions). */
  getUserId: GetUserIdFn;
}

/** Handler for create oauth disconnect. */
export function createOAuthDisconnectHandler(
  config: OAuthServiceConfig,
  options: OAuthDisconnectHandlerOptions,
): (req: Request) => Promise<Response> {
  const {
    tokenStore: configuredTokenStore,
    env = getEnvironmentConfig(),
    baseUrl,
    isAuthenticated,
    getUserId,
  } = options ??
    ({} as OAuthDisconnectHandlerOptions);
  const tokenStore = resolveOAuthHandlerTokenStore(configuredTokenStore, env);
  const service = new OAuthService(config, tokenStore);
  const appUrl = resolveOAuthApplicationUrl(baseUrl, env);

  return async function handler(req: Request): Promise<Response> {
    if (req.method !== "POST") return createMethodNotAllowedResponse("POST");
    const origin = req.headers.get("Origin");
    try {
      if (!origin || new URL(origin).origin !== appUrl.origin) return createForbiddenResponse();
    } catch {
      return createForbiddenResponse();
    }
    try {
      if (await isRequestUnauthorized(req, isAuthenticated)) {
        return createUnauthorizedResponse();
      }

      const userId = await resolveUserId(req, getUserId);
      if (!userId) return createUnauthorizedResponse();

      await tokenStore.clearTokens(service.serviceId, userId);

      return createOAuthJsonResponse({
        success: true,
        message: `Removed locally stored ${service.displayName} OAuth tokens`,
      });
    } catch (error) {
      logger.error("OAuth disconnect failed", { serviceId: service.serviceId }, error);
      return createOAuthJsonResponse(
        { error: "Failed to disconnect OAuth provider" },
        { status: 500 },
      );
    }
  };
}
