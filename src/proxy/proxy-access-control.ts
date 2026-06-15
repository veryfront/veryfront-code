import { getEnv } from "#veryfront/platform/compat/process.ts";
import type { AuthProvider } from "../extensions/auth/index.ts";
import { resolve as resolveContract } from "../extensions/contracts.ts";

export interface ProxyAccessControlLogger {
  debug: (msg: string, extra?: Record<string, unknown>) => void;
  info: (msg: string, extra?: Record<string, unknown>) => void;
  warn: (msg: string, extra?: Record<string, unknown>) => void;
  error: (msg: string, error?: Error, extra?: Record<string, unknown>) => void;
}

export interface ProtectedProxyEnvironment {
  name: string;
  protected?: boolean;
}

export interface ProtectedProxyProjectUser {
  id: string;
}

export interface ProxyAccessError {
  status: number;
  message: string;
  redirectUrl?: string;
}

/**
 * Cache the resolved AuthProvider at module scope so the proxy does not pay
 * the registry lookup on every request. The cache is cleared implicitly when
 * `ExtensionLoader.teardownAll()` clears the registry. The next call re-resolves
 * or surfaces the install hint if the extension was removed.
 */
let cachedAuthProvider: AuthProvider | undefined;

function getAuthProvider(): AuthProvider {
  if (cachedAuthProvider) return cachedAuthProvider;

  try {
    cachedAuthProvider = resolveContract<AuthProvider>("AuthProvider");
    return cachedAuthProvider;
  } catch (err) {
    const base = err instanceof Error ? err.message : String(err);
    throw new Error(
      `${base}\nTo enable JWT verification in the proxy, install ext-auth-jwt ` +
        `(scaffold with \`deno task cli extension init ext-auth-jwt\` or add the ` +
        `npm package @veryfront/ext-auth-jwt).`,
      { cause: err },
    );
  }
}

/**
 * Reset the cached AuthProvider. Intended for tests that `register()` a mock
 * after the handler module has been imported.
 *
 * @internal
 */
export function __resetCachedAuthProviderForTests(): void {
  cachedAuthProvider = undefined;
}

function resolveApiJwksUrl(
  apiBaseUrl: string,
  logger?: ProxyAccessControlLogger,
): string | undefined {
  try {
    const normalizedBaseUrl = apiBaseUrl.endsWith("/") ? apiBaseUrl : `${apiBaseUrl}/`;
    return new URL(".well-known/jwks.json", normalizedBaseUrl).toString();
  } catch (error) {
    logger?.error("Invalid API base URL for JWKS lookup", error as Error, {
      apiBaseUrl,
    });
    return undefined;
  }
}

export async function extractUserIdFromToken(
  token: string,
  apiBaseUrl: string,
  log?: ProxyAccessControlLogger,
): Promise<string | undefined> {
  const auth = getAuthProvider();

  const header = auth.decode(token);
  if (!header) {
    log?.debug("Failed to decode JWT header");
    return undefined;
  }

  const algorithm = header.alg;

  if (algorithm === "RS256") {
    const jwksUrl = resolveApiJwksUrl(apiBaseUrl, log);
    if (!jwksUrl) return undefined;

    try {
      const payload = await auth.verifyWithJwks(token, jwksUrl, {
        algorithms: ["RS256"],
      });
      return (payload as { userId?: string }).userId;
    } catch (error) {
      log?.debug("RS256 JWT verification failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  if (algorithm !== "HS256") {
    log?.debug("Unsupported JWT algorithm", { algorithm: algorithm ?? null });
    return undefined;
  }

  const jwtSecret = getEnv("JWT_SECRET");

  if (!jwtSecret) {
    log?.warn("JWT_SECRET not configured - cannot verify user token");
    return undefined;
  }

  try {
    // ext-auth-jwt reads JWT_SECRET from the environment when no `secret` was
    // passed to the extension factory; the explicit env check above is kept
    // so callers can warn once before attempting verification.
    const payload = await auth.verify(token, { algorithms: ["HS256"] });
    return (payload as { userId?: string }).userId;
  } catch (error) {
    log?.debug("JWT verification failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

export function buildProxyAuthRedirectUrl(url: URL): string {
  const safePath = url.pathname.replace(/^\/\/+/, "/");
  let returnPath = safePath + url.search;

  if (!returnPath.startsWith("/") || returnPath.includes("://")) {
    returnPath = "/";
  }

  const isHostedProductionDeployment = url.hostname.endsWith(".production.veryfront.org") ||
    url.hostname.endsWith(".production.veryfront.com");
  const returnTarget = isHostedProductionDeployment ? url.toString() : returnPath;

  return `https://veryfront.com/sign-in?from=${encodeURIComponent(returnTarget)}`;
}

export function isProjectMember(
  users: ProtectedProxyProjectUser[] | undefined,
  userId: string | undefined,
): boolean {
  if (!users || !userId) return false;
  return users.some((u) => u.id === userId);
}

export async function checkProtectedProxyAccess(input: {
  req: Request;
  url: URL;
  matchingEnv: ProtectedProxyEnvironment | undefined;
  userToken: string | undefined;
  users: ProtectedProxyProjectUser[] | undefined;
  apiBaseUrl: string;
  logger?: ProxyAccessControlLogger;
  logContext?: Record<string, unknown>;
  isSignedInternalControlPlaneRequest: boolean;
  extractUserIdFromToken?: (
    token: string,
    apiBaseUrl: string,
    log?: ProxyAccessControlLogger,
  ) => Promise<string | undefined>;
}): Promise<ProxyAccessError | null> {
  const {
    apiBaseUrl,
    logger,
    matchingEnv,
    url,
    userToken,
    users,
  } = input;
  const logContext = input.logContext ?? {};

  if (!matchingEnv?.protected) return null;

  if (input.isSignedInternalControlPlaneRequest) {
    logger?.debug(
      "Allowing signed internal control-plane request through protected environment",
      {
        ...logContext,
        environmentName: matchingEnv.name,
        pathname: url.pathname,
      },
    );
    return null;
  }

  if (!userToken) {
    const redirectUrl = buildProxyAuthRedirectUrl(url);
    logger?.info("Protected environment requires authentication", {
      ...logContext,
      environmentName: matchingEnv.name,
      redirectUrl,
    });
    return { status: 302, message: "Authentication required", redirectUrl };
  }

  const resolveUserId = input.extractUserIdFromToken ?? extractUserIdFromToken;
  const userId = await resolveUserId(
    userToken,
    apiBaseUrl,
    logger,
  );
  if (!userId) {
    const redirectUrl = buildProxyAuthRedirectUrl(url);
    logger?.info("Could not extract userId from token", {
      ...logContext,
      environmentName: matchingEnv.name,
      redirectUrl,
    });
    return { status: 302, message: "Authentication required", redirectUrl };
  }
  if (!isProjectMember(users, userId)) {
    logger?.info("User is not a member of the project", {
      ...logContext,
      environmentName: matchingEnv.name,
      userId,
    });
    return { status: 403, message: "Access denied" };
  }

  return null;
}
