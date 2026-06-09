import { logger as baseLogger } from "#veryfront/utils";
import {
  type EnvironmentConfig,
  getEnvironmentConfig,
} from "#veryfront/config/environment-config.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import { type EnvReader, OAuthService } from "../providers/base.ts";
import type { AuthorizationUrlOptions, OAuthServiceConfig, TokenStore } from "../types.ts";
import { memoryTokenStore } from "../token-store/memory.ts";

const logger = baseLogger.component("o-auth");
const DEFAULT_APP_URL = "http://localhost:3000";

function createUnauthorizedResponse(): Response {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
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
  if (!result) return null; // null, undefined, or empty string all fail.
  return result;
}

function resolveAppUrl(baseUrl: string | undefined, env: EnvironmentConfig): string {
  return baseUrl ?? env.appUrl ?? DEFAULT_APP_URL;
}

function createNotConfiguredResponse(config: OAuthServiceConfig): Response {
  // SEC-009: Do NOT leak internal env var names in the HTTP response body.
  // Operators still need the diagnostic, so log the missing env var names
  // server-side via the existing logger.
  logger.error("OAuth provider not configured", {
    serviceId: config.serviceId,
    displayName: config.displayName,
    missingVars: [config.clientIdEnvVar, config.clientSecretEnvVar],
  });
  return Response.json(
    { error: `${config.displayName} OAuth not configured` },
    { status: 503 },
  );
}

function createInitErrorResponse(): Response {
  // SEC-009: do NOT leak internal error details (file paths, library
  // internals) to the client. The caller already logs the full error
  // server-side; return a generic message here.
  return Response.json(
    { error: "Failed to initiate OAuth flow" },
    { status: 500 },
  );
}

/** Signature for resolving the authenticated user's ID from a request. */
export type GetUserIdFn = (req: Request) => string | null | Promise<string | null>;

/** Options accepted by oauth init handler. */
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
    tokenStore = memoryTokenStore,
    baseUrl,
    authOptions = {},
    env = getEnvironmentConfig(),
    envReader = getEnv,
    isAuthenticated,
    getUserId,
  } = options ?? ({} as OAuthInitHandlerOptions);

  return async function handler(req: Request): Promise<Response> {
    if (await isRequestUnauthorized(req, isAuthenticated)) {
      return createUnauthorizedResponse();
    }

    const userId = await resolveUserId(req, getUserId);
    if (!userId) return createUnauthorizedResponse();

    const service = new OAuthService(config, tokenStore, envReader);

    if (!service.isConfigured()) {
      return createNotConfiguredResponse(config);
    }

    const appUrl = resolveAppUrl(baseUrl, env);
    const redirectUri = `${appUrl}/api/auth/${config.serviceId}/callback`;

    try {
      const { url, state } = await service.createAuthorizationUrl({ ...authOptions, redirectUri });
      await tokenStore.setState(state.state, {
        userId,
        serviceId: config.serviceId,
        codeVerifier: state.codeVerifier,
        redirectUri: state.redirectUri,
        scopes: state.scopes,
        createdAt: state.createdAt,
        metadata: state.metadata,
      });
      return Response.redirect(url);
    } catch (error) {
      logger.error("Init error", { serviceId: config.serviceId }, error);
      return createInitErrorResponse();
    }
  };
}

export interface OAuthStatusHandlerOptions {
  /** Token store to use (defaults to memory store) */
  tokenStore?: TokenStore;

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
    tokenStore = memoryTokenStore,
    envReader = getEnv,
    isAuthenticated,
    getUserId,
  } = options ?? ({} as OAuthStatusHandlerOptions);

  return async function handler(req: Request): Promise<Response> {
    if (await isRequestUnauthorized(req, isAuthenticated)) {
      return createUnauthorizedResponse();
    }

    const userId = await resolveUserId(req, getUserId);
    if (!userId) return createUnauthorizedResponse();

    const tokens = await tokenStore.getTokens(config.serviceId, userId);

    const isConnected = !!tokens?.accessToken;
    const isExpired = tokens?.expiresAt ? Date.now() > tokens.expiresAt : false;
    const hasRefreshToken = !!tokens?.refreshToken;

    return Response.json({
      service: config.serviceId,
      displayName: config.displayName,
      connected: isConnected && (!isExpired || hasRefreshToken),
      configured: !!(envReader(config.clientIdEnvVar) && envReader(config.clientSecretEnvVar)),
      expiresAt: tokens?.expiresAt,
      hasRefreshToken,
    });
  };
}

export interface OAuthDisconnectHandlerOptions {
  tokenStore?: TokenStore;
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
  const { tokenStore = memoryTokenStore, isAuthenticated, getUserId } = options ??
    ({} as OAuthDisconnectHandlerOptions);

  return async function handler(req: Request): Promise<Response> {
    if (await isRequestUnauthorized(req, isAuthenticated)) {
      return createUnauthorizedResponse();
    }

    const userId = await resolveUserId(req, getUserId);
    if (!userId) return createUnauthorizedResponse();

    await tokenStore.clearTokens(config.serviceId, userId);

    return Response.json({
      success: true,
      message: `Disconnected from ${config.displayName}`,
    });
  };
}
