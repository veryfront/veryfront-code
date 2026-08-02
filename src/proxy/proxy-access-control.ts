import { getEnv } from "#veryfront/platform/compat/process.ts";
import type { AuthProvider } from "../extensions/auth/index.ts";
import { resolve as resolveContract } from "../extensions/contracts.ts";
import { INITIALIZATION_ERROR } from "#veryfront/errors";
import { normalizeProxyOriginFormPath } from "./request-path.ts";

export interface ProxyAccessControlLogger {
  debug: (msg: string, extra?: Record<string, unknown>) => void;
  info: (msg: string, extra?: Record<string, unknown>) => void;
  warn: (msg: string, extra?: Record<string, unknown>) => void;
  error: (msg: string, error?: unknown, extra?: Record<string, unknown>) => void;
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

function getAuthProvider(): AuthProvider {
  try {
    return resolveContract<AuthProvider>("AuthProvider");
  } catch (cause) {
    throw INITIALIZATION_ERROR.create({
      detail: `The AuthProvider extension contract is unavailable. ` +
        `To enable JWT verification in the proxy, install ext-auth-jwt ` +
        `(scaffold with \`deno task cli extension init ext-auth-jwt\` or add the ` +
        `npm package @veryfront/ext-auth-jwt).`,
      cause,
    });
  }
}

function safeErrorMessage(error: unknown): string {
  try {
    if (!(error instanceof Error)) return "Unknown authentication error";
    const descriptor = Object.getOwnPropertyDescriptor(error, "message");
    return descriptor && "value" in descriptor && typeof descriptor.value === "string"
      ? descriptor.value
      : "Unknown authentication error";
  } catch {
    return "Unknown authentication error";
  }
}

function readOwnString(
  value: unknown,
  key: string,
  maximumCodeUnits: number,
): string | undefined {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) return undefined;
    const text = descriptor.value;
    if (typeof text !== "string" || text.length === 0 || text.length > maximumCodeUnits) {
      return undefined;
    }
    for (let index = 0; index < text.length; index++) {
      const codeUnit = text.charCodeAt(index);
      if (codeUnit <= 0x1f || codeUnit === 0x7f) return undefined;
    }
    return text;
  } catch {
    return undefined;
  }
}

function resolveApiJwksUrl(
  apiBaseUrl: string,
  logger?: ProxyAccessControlLogger,
): string | undefined {
  try {
    const base = new URL(apiBaseUrl);
    if (
      (base.protocol !== "http:" && base.protocol !== "https:") ||
      !base.hostname ||
      base.username !== "" ||
      base.password !== ""
    ) {
      throw new TypeError("Proxy API base URL must be a credential-free HTTP(S) URL");
    }
    base.search = "";
    base.hash = "";
    if (!base.pathname.endsWith("/")) base.pathname += "/";
    return new URL(".well-known/jwks.json", base).toString();
  } catch (error) {
    logger?.error("Invalid API base URL for JWKS lookup", error, {
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

  let header: unknown;
  try {
    header = auth.decode(token);
  } catch (error) {
    log?.debug("Failed to decode JWT header", {
      error: safeErrorMessage(error),
    });
    return undefined;
  }
  if (!header) {
    log?.debug("Failed to decode JWT header");
    return undefined;
  }

  const algorithm = readOwnString(header, "alg", 32);

  if (algorithm === "RS256") {
    const jwksUrl = resolveApiJwksUrl(apiBaseUrl, log);
    if (!jwksUrl) return undefined;

    try {
      const payload = await auth.verifyWithJwks(token, jwksUrl, {
        algorithms: ["RS256"],
      });
      return readOwnString(payload, "userId", 512);
    } catch (error) {
      log?.debug("RS256 JWT verification failed", {
        error: safeErrorMessage(error),
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
    return readOwnString(payload, "userId", 512);
  } catch (error) {
    log?.debug("JWT verification failed", {
      error: safeErrorMessage(error),
    });
    return undefined;
  }
}

export function buildProxyAuthRedirectUrl(url: URL): string {
  const safePath = normalizeProxyOriginFormPath(url.pathname);
  const returnPath = safePath + url.search;

  const isHostedProductionDeployment = url.hostname.endsWith(".production.veryfront.org") ||
    url.hostname.endsWith(".production.veryfront.com");
  // For hosted production, preserve the absolute origin so the user returns to
  // the correct subdomain — but rebuild it from the allowlisted hostname and the
  // already-sanitized path instead of the raw request URL. This prevents
  // userinfo/port/other components of the inbound URL from smuggling a foreign
  // target into the `from` param (open-redirect hardening).
  const returnTarget = isHostedProductionDeployment
    ? `https://${url.hostname}${returnPath}`
    : returnPath;

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
