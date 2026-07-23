import { logger as baseLogger } from "#veryfront/utils";
import {
  type EnvironmentConfig,
  getEnvironmentConfig,
} from "#veryfront/config/environment-config.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";
import { type EnvReader, OAuthService } from "../providers/base.ts";
import type { AuthorizationUrlOptions, OAuthServiceConfig, TokenStore } from "../types.ts";
import { isValidOAuthTokens } from "../validation.ts";
import { memoryTokenStore } from "../token-store/memory.ts";
import {
  createNoStoreJson,
  createNoStoreRedirect,
  createOAuthCallbackUri,
  getErrorName,
  resolveOAuthAppUrl,
} from "./http-utils.ts";

const logger = baseLogger.component("o-auth");
const MAX_USER_ID_LENGTH = 4_096;

function createUnauthorizedResponse(): Response {
  return createNoStoreJson({ error: "Unauthorized" }, 401);
}

async function isRequestUnauthorized(
  req: Request,
  isAuthenticated?: (req: Request) => boolean | Promise<boolean>,
): Promise<boolean> {
  return isAuthenticated ? (await isAuthenticated(req)) !== true : false;
}

/**
 * Resolve the userId for a request, returning null when anonymous.
 *
 * `getUserId` is required at compile time (see handler option types). We
 * still tolerate `undefined` at runtime (e.g. a JS caller) and treat it as
 * unauthenticated. Never fall back to "anonymous": that preserves
 * VULN-AUTH-2 where unrelated users share a single token slot.
 */
async function resolveUserId(
  req: Request,
  getUserId: GetUserIdFn | undefined,
): Promise<string | null> {
  if (!getUserId) return null;
  const result = await getUserId(req);
  if (
    typeof result !== "string" || result.trim().length === 0 ||
    result.length > MAX_USER_ID_LENGTH
  ) return null;
  return result;
}

function createNotConfiguredResponse(
  config: Pick<
    OAuthServiceConfig,
    "serviceId" | "displayName" | "clientIdEnvVar" | "clientSecretEnvVar"
  >,
): Response {
  // SEC-009: Do NOT leak internal env var names in the HTTP response body.
  // Operators still need the diagnostic, so log the missing env var names
  // server-side via the existing logger.
  logger.error("OAuth provider not configured", {
    serviceId: config.serviceId,
    displayName: config.displayName,
    missingVars: [config.clientIdEnvVar, config.clientSecretEnvVar],
  });
  return createNoStoreJson({ error: `${config.displayName} OAuth not configured` }, 503);
}

function snapshotAuthorizationOptions(options: AuthorizationUrlOptions): AuthorizationUrlOptions {
  if (options.state !== undefined) {
    throw INVALID_ARGUMENT.create({
      detail: "OAuth init handlers generate a unique state for every request",
    });
  }
  const scopes = options.scopes ? [...options.scopes] : undefined;
  const additionalParams = options.additionalParams ? { ...options.additionalParams } : undefined;
  if (scopes) Object.freeze(scopes);
  if (additionalParams) Object.freeze(additionalParams);
  const snapshot = { ...options, scopes, additionalParams };
  return Object.freeze(snapshot);
}

function createInitErrorResponse(): Response {
  // SEC-009: do NOT leak internal error details (file paths, library
  // internals) to the client. The caller already logs the full error
  // server-side; return a generic message here.
  return createNoStoreJson({ error: "Failed to initiate OAuth flow" }, 500);
}

/** Signature for resolving the authenticated user's ID from a request. */
export type GetUserIdFn = (
  req: Request,
) => string | null | undefined | Promise<string | null | undefined>;

/** Options for {@link createOAuthInitHandler}. */
export interface OAuthInitHandlerOptions {
  /** Token store to use (defaults to memory store) */
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
   * requests with 401. Never return a shared constant like "anonymous" because
   * that re-introduces VULN-AUTH-2.
   */
  getUserId: GetUserIdFn;
}

/**
 * Create a handler that authenticates the caller, persists one-time OAuth
 * state, and redirects the caller to the provider authorization endpoint.
 */
export function createOAuthInitHandler(
  config: OAuthServiceConfig,
  options: OAuthInitHandlerOptions,
): (req: Request) => Promise<Response> {
  const tokenStore = options?.tokenStore ?? memoryTokenStore;
  const baseUrl = options?.baseUrl;
  const authOptions = snapshotAuthorizationOptions(options?.authOptions ?? {});
  const env = options?.env ?? getEnvironmentConfig();
  const envReader = options?.envReader ?? getEnv;
  const isAuthenticated = options?.isAuthenticated;
  const getUserId = options?.getUserId;
  const service = new OAuthService(config, tokenStore, envReader);
  const serviceId = service.serviceId;
  const serviceConfig = Object.freeze({
    serviceId,
    displayName: config.displayName,
    clientIdEnvVar: config.clientIdEnvVar,
    clientSecretEnvVar: config.clientSecretEnvVar,
  });

  return async function handler(req: Request): Promise<Response> {
    try {
      if (await isRequestUnauthorized(req, isAuthenticated)) {
        return createUnauthorizedResponse();
      }

      const userId = await resolveUserId(req, getUserId);
      if (!userId) return createUnauthorizedResponse();

      if (!service.isConfigured()) return createNotConfiguredResponse(serviceConfig);

      const appUrl = resolveOAuthAppUrl(baseUrl, env);
      const redirectUri = createOAuthCallbackUri(appUrl, serviceId);
      const { url, state } = await service.createAuthorizationUrl({ ...authOptions, redirectUri });
      await tokenStore.setState(state.state, {
        userId,
        serviceId,
        codeVerifier: state.codeVerifier,
        redirectUri: state.redirectUri,
        scopes: state.scopes,
        createdAt: state.createdAt,
        metadata: state.metadata,
      });
      return createNoStoreRedirect(url);
    } catch (error) {
      logger.error("OAuth init request failed", {
        serviceId,
        errorName: getErrorName(error),
      });
      return createInitErrorResponse();
    }
  };
}

/** Options for {@link createOAuthStatusHandler}. */
export interface OAuthStatusHandlerOptions {
  /** Token store to use (defaults to memory store) */
  tokenStore?: TokenStore;

  /** EnvReader for dynamic env vars (defaults to getEnv) */
  envReader?: EnvReader;

  /** Optional authentication check. Return true if the request is authenticated. */
  isAuthenticated?: (req: Request) => boolean | Promise<boolean>;

  /** REQUIRED. Resolve the authenticated user's ID (see OAuthInitHandlerOptions). */
  getUserId: GetUserIdFn;
}

/** Create a no-store handler that reports the caller's OAuth connection status. */
export function createOAuthStatusHandler(
  config: OAuthServiceConfig,
  options: OAuthStatusHandlerOptions,
): (req: Request) => Promise<Response> {
  const tokenStore = options?.tokenStore ?? memoryTokenStore;
  const envReader = options?.envReader ?? getEnv;
  const isAuthenticated = options?.isAuthenticated;
  const getUserId = options?.getUserId;
  const service = new OAuthService(config, tokenStore, envReader);
  const serviceId = service.serviceId;
  const displayName = config.displayName;

  return async function handler(req: Request): Promise<Response> {
    try {
      if (await isRequestUnauthorized(req, isAuthenticated)) {
        return createUnauthorizedResponse();
      }

      const userId = await resolveUserId(req, getUserId);
      if (!userId) return createUnauthorizedResponse();

      const tokens = await tokenStore.getTokens(serviceId, userId);
      const validTokens = tokens && isValidOAuthTokens(tokens) ? tokens : null;
      const isConnected = !!validTokens;
      const isExpired = validTokens?.expiresAt !== undefined
        ? Date.now() >= validTokens.expiresAt
        : false;
      const hasRefreshToken = !!validTokens?.refreshToken;

      return createNoStoreJson({
        service: serviceId,
        displayName,
        connected: isConnected && (!isExpired || hasRefreshToken),
        configured: service.isConfigured(),
        expiresAt: validTokens?.expiresAt,
        hasRefreshToken,
      });
    } catch (error) {
      logger.error("OAuth status request failed", {
        serviceId,
        errorName: getErrorName(error),
      });
      return createNoStoreJson({ error: "OAuth request failed" }, 500);
    }
  };
}

/** Options for {@link createOAuthDisconnectHandler}. */
export interface OAuthDisconnectHandlerOptions {
  /** Token store to use. Defaults to the development-only memory store. */
  tokenStore?: TokenStore;
  /** EnvReader for provider credentials and request timeout configuration. */
  envReader?: EnvReader;
  /** Optional authentication check. Return true if the request is authenticated. */
  isAuthenticated?: (req: Request) => boolean | Promise<boolean>;
  /** REQUIRED. Resolve the authenticated user's ID (see OAuthInitHandlerOptions). */
  getUserId: GetUserIdFn;
}

/**
 * Create a handler that revokes provider credentials when supported, then
 * clears the caller's local token slot. A failed provider revocation returns
 * 502 and retains the local token so the request can be retried. The handler
 * accepts `POST` requests only.
 */
export function createOAuthDisconnectHandler(
  config: OAuthServiceConfig,
  options: OAuthDisconnectHandlerOptions,
): (req: Request) => Promise<Response> {
  const tokenStore = options?.tokenStore ?? memoryTokenStore;
  const envReader = options?.envReader ?? getEnv;
  const isAuthenticated = options?.isAuthenticated;
  const getUserId = options?.getUserId;
  const service = new OAuthService(config, tokenStore, envReader);
  const serviceId = service.serviceId;
  const displayName = config.displayName;
  const hasRevocationEndpoint = config.revocationUrl !== undefined;

  return async function handler(req: Request): Promise<Response> {
    if (req.method.toUpperCase() !== "POST") {
      const response = createNoStoreJson({ error: "Method not allowed" }, 405);
      response.headers.set("Allow", "POST");
      return response;
    }
    try {
      if (await isRequestUnauthorized(req, isAuthenticated)) {
        return createUnauthorizedResponse();
      }

      const userId = await resolveUserId(req, getUserId);
      if (!userId) return createUnauthorizedResponse();

      const tokens = await tokenStore.getTokens(serviceId, userId);
      if (tokens && hasRevocationEndpoint) {
        const revoked = await service.revokeToken(tokens.refreshToken ?? tokens.accessToken);
        if (!revoked) {
          return createNoStoreJson({ error: "OAuth token revocation failed" }, 502);
        }
      }

      await tokenStore.clearTokens(serviceId, userId);

      return createNoStoreJson({
        success: true,
        message: `Disconnected from ${displayName}`,
      });
    } catch (error) {
      logger.error("OAuth disconnect request failed", {
        serviceId,
        errorName: getErrorName(error),
      });
      return createNoStoreJson({ error: "OAuth request failed" }, 500);
    }
  };
}
