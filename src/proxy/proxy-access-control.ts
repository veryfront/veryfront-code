import { getEnv } from "#veryfront/platform/compat/process.ts";
import type { AuthProvider } from "../extensions/auth/index.ts";
import { resolve as resolveContract } from "../extensions/contracts.ts";
import { INITIALIZATION_ERROR } from "#veryfront/errors";

/** Logger contract used by protected-environment authorization. */
export interface ProxyAccessControlLogger {
  /** Write diagnostic context. */
  debug: (msg: string, extra?: Record<string, unknown>) => void;
  /** Write normal authorization decisions. */
  info: (msg: string, extra?: Record<string, unknown>) => void;
  /** Write recoverable verification failures. */
  warn: (msg: string, extra?: Record<string, unknown>) => void;
  /** Write a contained error and sanitized context. */
  error: (msg: string, error?: Error, extra?: Record<string, unknown>) => void;
}

/** Environment fields used by the protected-route decision. */
export interface ProtectedProxyEnvironment {
  /** Canonical environment name. */
  name: string;
  /** Whether user authentication and membership are required. */
  protected?: boolean;
}

/** Project membership record used by proxy authorization. */
export interface ProtectedProxyProjectUser {
  /** Verified user identifier. */
  id: string;
}

/** Public authorization error returned by the proxy. */
export interface ProxyAccessError {
  /** HTTP response status. */
  status: number;
  /** Public authorization message. */
  message: string;
  /** Approved sign-in redirect URL. */
  redirectUrl?: string;
}

function getAuthProvider(): AuthProvider {
  try {
    // Contract registration is mutable during extension teardown/reload. A
    // registry lookup is a bounded in-memory map read and avoids retaining a
    // revoked provider across lifecycle transitions.
    return resolveContract<AuthProvider>("AuthProvider");
  } catch (err) {
    const base = err instanceof Error ? err.message : String(err);
    throw INITIALIZATION_ERROR.create({
      detail: `${base}\nTo enable JWT verification in the proxy, install ext-auth-jwt ` +
        `(scaffold with \`deno task cli extension init ext-auth-jwt\` or add the ` +
        `npm package @veryfront/ext-auth-jwt).`,
      cause: err,
    });
  }
}

/**
 * Retain the historical AuthProvider reset seam for compatible test harnesses.
 *
 * @internal
 */
export function __resetCachedAuthProviderForTests(): void {
  // Kept as a compatibility no-op for existing test harnesses. Providers are
  // resolved from the registry for every verification attempt.
}

function resolveApiJwksUrl(
  apiBaseUrl: string,
  logger?: ProxyAccessControlLogger,
): string | undefined {
  try {
    const baseUrl = new URL(apiBaseUrl);
    if (
      (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") ||
      baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash
    ) return undefined;
    baseUrl.pathname = `${baseUrl.pathname.replace(/\/+$/, "")}/`;
    return new URL(".well-known/jwks.json", baseUrl).toString();
  } catch (error) {
    logger?.error("Invalid API base URL for JWKS lookup", error as Error);
    return undefined;
  }
}

const MAX_USER_JWT_LENGTH = 16_384;
const MAX_USER_ID_LENGTH = 1_024;

function readOwnStringProperty(
  value: unknown,
  key: string,
  maximumLength: number,
): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    return undefined;
  }
  if (!descriptor || !("value" in descriptor)) return undefined;
  return typeof descriptor.value === "string" && descriptor.value.length > 0 &&
      descriptor.value.length <= maximumLength
    ? descriptor.value
    : undefined;
}

function readVerifiedUserId(payload: unknown): string | undefined {
  return readOwnStringProperty(payload, "userId", MAX_USER_ID_LENGTH);
}

/** Verify a bounded JWT and return its own string user identifier claim. */
export async function extractUserIdFromToken(
  token: string,
  apiBaseUrl: string,
  log?: ProxyAccessControlLogger,
): Promise<string | undefined> {
  if (token.length === 0 || token.length > MAX_USER_JWT_LENGTH) {
    log?.debug("JWT is empty or exceeds the allowed size");
    return undefined;
  }
  const auth = getAuthProvider();

  let header;
  try {
    header = auth.decode(token);
  } catch {
    log?.debug("Failed to decode JWT header");
    return undefined;
  }
  const algorithm = readOwnStringProperty(header, "alg", 32);
  if (!algorithm) {
    log?.debug("Failed to decode JWT header");
    return undefined;
  }

  if (algorithm === "RS256") {
    const jwksUrl = resolveApiJwksUrl(apiBaseUrl, log);
    if (!jwksUrl) return undefined;

    try {
      const payload = await auth.verifyWithJwks(token, jwksUrl, {
        algorithms: ["RS256"],
      });
      return readVerifiedUserId(payload);
    } catch {
      log?.debug("RS256 JWT verification failed");
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
    return readVerifiedUserId(payload);
  } catch {
    log?.debug("JWT verification failed");
    return undefined;
  }
}

/** Build a fixed-origin sign-in URL with a bounded-origin return target. */
export function buildProxyAuthRedirectUrl(url: URL): string {
  const safePath = url.pathname.replace(/^\/\/+/, "/");
  let returnPath = safePath + url.search;

  if (!returnPath.startsWith("/") || returnPath.includes("://")) {
    returnPath = "/";
  }

  const isHostedProductionDeployment = url.hostname.endsWith(".production.veryfront.org") ||
    url.hostname.endsWith(".production.veryfront.com");
  // For hosted production, preserve the absolute origin so the user returns to
  // the correct subdomain, but rebuild it from the allowlisted hostname and the
  // already-sanitized path instead of the raw request URL. This prevents
  // userinfo/port/other components of the inbound URL from smuggling a foreign
  // target into the `from` param (open-redirect hardening).
  const returnTarget = isHostedProductionDeployment
    ? `https://${url.hostname}${returnPath}`
    : returnPath;

  return `https://veryfront.com/sign-in?from=${encodeURIComponent(returnTarget)}`;
}

/** Return whether the verified user identifier belongs to the project. */
export function isProjectMember(
  users: ProtectedProxyProjectUser[] | undefined,
  userId: string | undefined,
): boolean {
  if (!users || !userId) return false;
  return users.some((u) => u.id === userId);
}

/** Enforce authentication and project membership for a protected environment. */
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
      pathname: url.pathname,
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
      pathname: url.pathname,
    });
    return { status: 302, message: "Authentication required", redirectUrl };
  }
  if (!isProjectMember(users, userId)) {
    logger?.info("User is not a member of the project", {
      ...logContext,
      environmentName: matchingEnv.name,
    });
    return { status: 403, message: "Access denied" };
  }

  return null;
}
