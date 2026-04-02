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

function resolveAppUrl(baseUrl: string | undefined, env: EnvironmentConfig): string {
  return baseUrl ?? env.appUrl ?? DEFAULT_APP_URL;
}

function createNotConfiguredResponse(config: OAuthServiceConfig): Response {
  return Response.json(
    {
      error: `${config.displayName} OAuth not configured`,
      details: `Missing ${config.clientIdEnvVar} or ${config.clientSecretEnvVar}`,
    },
    { status: 500 },
  );
}

function createInitErrorResponse(error: unknown): Response {
  return Response.json(
    {
      error: "Failed to initiate OAuth flow",
      details: error instanceof Error ? error.message : "Unknown error",
    },
    { status: 500 },
  );
}

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
}

export function createOAuthInitHandler(
  config: OAuthServiceConfig,
  options: OAuthInitHandlerOptions = {},
): () => Promise<Response> {
  const {
    tokenStore = memoryTokenStore,
    baseUrl,
    authOptions = {},
    env = getEnvironmentConfig(),
    envReader = getEnv,
  } = options;

  return async function handler(): Promise<Response> {
    const service = new OAuthService(config, tokenStore, envReader);

    if (!service.isConfigured()) {
      return createNotConfiguredResponse(config);
    }

    const appUrl = resolveAppUrl(baseUrl, env);
    const redirectUri = `${appUrl}/api/auth/${config.serviceId}/callback`;

    try {
      const { url, state } = await service.createAuthorizationUrl({ ...authOptions, redirectUri });
      await tokenStore.setState(state);
      return Response.redirect(url);
    } catch (error) {
      logger.error("Init error", { serviceId: config.serviceId }, error);
      return createInitErrorResponse(error);
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
}

export function createOAuthStatusHandler(
  config: OAuthServiceConfig,
  options: OAuthStatusHandlerOptions = {},
): (req: Request) => Promise<Response> {
  const {
    tokenStore = memoryTokenStore,
    envReader = getEnv,
    isAuthenticated,
  } = options;

  return async function handler(req: Request): Promise<Response> {
    if (await isRequestUnauthorized(req, isAuthenticated)) {
      return createUnauthorizedResponse();
    }

    const tokens = await tokenStore.getTokens(config.serviceId);

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

export function createOAuthDisconnectHandler(
  config: OAuthServiceConfig,
  options: {
    tokenStore?: TokenStore;
    /** Optional authentication check — return true if the request is authenticated */
    isAuthenticated?: (req: Request) => boolean | Promise<boolean>;
  } = {},
): (req: Request) => Promise<Response> {
  const { tokenStore = memoryTokenStore, isAuthenticated } = options;

  return async function handler(req: Request): Promise<Response> {
    if (await isRequestUnauthorized(req, isAuthenticated)) {
      return createUnauthorizedResponse();
    }

    await tokenStore.clearTokens(config.serviceId);

    return Response.json({
      success: true,
      message: `Disconnected from ${config.displayName}`,
    });
  };
}
