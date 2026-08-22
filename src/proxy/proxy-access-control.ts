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
  id?: string;
  name: string;
  protected?: boolean;
}

/** Who a verified token speaks for at the gate, and what it is bound to. */
export interface ProxyPrincipal {
  userId: string;
  /** Present for an environment access token: the one target it may open. */
  environmentAccess?: { projectId: string; environmentId: string };
}

const ENVIRONMENT_ACCESS_TOKEN_USE = "environment_access";
const ENVIRONMENT_GATE_AUDIENCE = "environment-gate";

function hasGateAudience(payload: unknown): boolean {
  if (typeof payload !== "object" || payload === null) return false;
  if (!Object.hasOwn(payload, "aud")) return false;
  const aud = (payload as Record<string, unknown>).aud;
  if (typeof aud === "string") return aud === ENVIRONMENT_GATE_AUDIENCE;
  return Array.isArray(aud) && aud.includes(ENVIRONMENT_GATE_AUDIENCE);
}

/**
 * Reads the principal off a verified payload.
 *
 * A plain user token speaks for its user. An environment access token has to
 * say so twice, by audience and by use, and name both the project and the
 * environment it is bound to; anything that claims only part of that is not a
 * credential this gate issued for and is refused outright.
 */
export function toProxyPrincipal(payload: unknown): ProxyPrincipal | undefined {
  const userId = readOwnString(payload, "userId", 512);
  if (!userId) return undefined;

  const tokenUse = readOwnString(payload, "tokenUse", 64);
  const gateAudience = hasGateAudience(payload);
  if (tokenUse === undefined && !gateAudience) return { userId };
  if (tokenUse !== ENVIRONMENT_ACCESS_TOKEN_USE || !gateAudience) return undefined;

  const projectId = readOwnString(payload, "projectId", 512);
  const environmentId = readOwnString(payload, "environmentId", 512);
  if (!projectId || !environmentId) return undefined;
  return { userId, environmentAccess: { projectId, environmentId } };
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
  return (await extractProxyPrincipal(token, apiBaseUrl, log))?.userId;
}

export async function extractProxyPrincipal(
  token: string,
  apiBaseUrl: string,
  log?: ProxyAccessControlLogger,
): Promise<ProxyPrincipal | undefined> {
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
      return toProxyPrincipal(payload);
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
    return toProxyPrincipal(payload);
  } catch (error) {
    log?.debug("JWT verification failed", {
      error: safeErrorMessage(error),
    });
    return undefined;
  }
}

/**
 * Apex domains that may host the sign-in page, most specific first.
 *
 * The result is always one of these constants, never a value taken from the
 * request, so a forged Host header cannot redirect a user off-platform.
 */
const SIGN_IN_APEX_DOMAINS = ["veryfront.org", "veryfront.com"] as const;
const DEFAULT_SIGN_IN_APEX = "veryfront.com";

/**
 * Pick the sign-in host matching the environment the request arrived on.
 *
 * This used to be hardcoded to production. A staging visitor was therefore sent
 * to veryfront.com to sign in, received a cookie scoped to that domain, and
 * returned to a veryfront.org host that never receives it, so the redirect loop
 * could not close and staging previews were unreachable while signed in.
 */
function resolveSignInApex(hostname: string, isHostedProductionDeployment: boolean): string {
  // Production-mode deployments keep the default apex. `*.production.veryfront.org`
  // has signed in at veryfront.com since #1827, and which environment owns that
  // hostname is not derivable from the code, so it is left alone rather than
  // changed on an assumption. Only preview hosts, which the cluster shows split
  // cleanly (production serves *.preview.veryfront.com, staging serves
  // *.preview.veryfront.org), are routed by apex here.
  if (isHostedProductionDeployment) return DEFAULT_SIGN_IN_APEX;

  for (const apex of SIGN_IN_APEX_DOMAINS) {
    if (hostname === apex || hostname.endsWith(`.${apex}`)) return apex;
  }
  return DEFAULT_SIGN_IN_APEX;
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

  const signInApex = resolveSignInApex(url.hostname, isHostedProductionDeployment);
  return `https://${signInApex}/sign-in?from=${encodeURIComponent(returnTarget)}`;
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
  /** The project the matching environment belongs to, for bound tokens. */
  projectId?: string;
  userToken: string | undefined;
  users: ProtectedProxyProjectUser[] | undefined;
  apiBaseUrl: string;
  logger?: ProxyAccessControlLogger;
  logContext?: Record<string, unknown>;
  isSignedInternalControlPlaneRequest: boolean;
  extractPrincipal?: (
    token: string,
    apiBaseUrl: string,
    log?: ProxyAccessControlLogger,
  ) => Promise<ProxyPrincipal | undefined>;
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

  const resolvePrincipal = input.extractPrincipal ?? extractProxyPrincipal;
  const principal = await resolvePrincipal(
    userToken,
    apiBaseUrl,
    logger,
  );
  if (!principal) {
    const redirectUrl = buildProxyAuthRedirectUrl(url);
    logger?.info("Could not extract userId from token", {
      ...logContext,
      environmentName: matchingEnv.name,
      redirectUrl,
    });
    return { status: 302, message: "Authentication required", redirectUrl };
  }
  const { userId, environmentAccess } = principal;
  if (environmentAccess) {
    // A bound token opens the one environment it names, nothing else. An
    // environment the proxy cannot identify fails closed.
    const boundElsewhere = input.projectId === undefined ||
      environmentAccess.projectId !== input.projectId ||
      matchingEnv.id === undefined ||
      environmentAccess.environmentId !== matchingEnv.id;
    if (boundElsewhere) {
      logger?.info("Environment access token is bound to another target", {
        ...logContext,
        environmentName: matchingEnv.name,
        userId,
      });
      return { status: 403, message: "Access denied" };
    }
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
