import type { TokenRequestOptions, TokenScope } from "./token-manager.ts";
import { createAbortError } from "#veryfront/utils/abort.ts";
import { OAuthTokenRequestError } from "./oauth-client.ts";

const MAX_AUTH_COOKIE_HEADER_CODE_UNITS = 64 * 1024;
const MAX_USER_TOKEN_CODE_UNITS = 64 * 1024;

export interface ProxyTokenResolutionConfig {
  apiClientId: string;
  apiClientSecret: string;
  apiToken?: string;
}

export interface ProxyTokenManager {
  getToken(
    scope: TokenScope,
    projectSlug?: string,
    customDomain?: string,
    options?: TokenRequestOptions,
  ): Promise<string>;
}

export interface ProxyTokenResolutionLogger {
  debug: (msg: string, extra?: Record<string, unknown>) => void;
  info: (msg: string, extra?: Record<string, unknown>) => void;
  warn: (msg: string, extra?: Record<string, unknown>) => void;
  error: (msg: string, error?: unknown, extra?: Record<string, unknown>) => void;
}

export interface ResolveProxyRequestTokenOptions {
  req: Request;
  url: URL;
  scope: TokenScope;
  host: string;
  projectSlug: string | undefined;
  config: ProxyTokenResolutionConfig;
  tokenManager: ProxyTokenManager;
  logger?: ProxyTokenResolutionLogger;
  allowSignedInternalControlPlaneToken?: boolean;
  signedInternalControlPlaneRequest?: boolean;
  tokenStrategy?: "preview-user-first" | "service-first";
  tokenFetchErrorMessage: string;
}

export interface ResolvedProxyRequestToken {
  token?: string;
  tokenSource?: "signed-internal" | "user" | "service" | "static";
  userToken?: string;
  tokenFetchError?: unknown;
}

export function extractUserToken(cookieHeader: string): string | undefined {
  if (
    cookieHeader === "" ||
    cookieHeader.length > MAX_AUTH_COOKIE_HEADER_CODE_UNITS
  ) {
    return undefined;
  }
  let token: string | undefined;
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex < 1) continue;
    if (trimmed.slice(0, separatorIndex).trim() !== "authToken") continue;
    if (token !== undefined) return undefined;

    const encoded = trimmed.slice(separatorIndex + 1);
    if (encoded === "") return undefined;
    try {
      const decoded = decodeURIComponent(encoded);
      if (
        decoded.length === 0 ||
        decoded.length > MAX_USER_TOKEN_CODE_UNITS ||
        /[^\u0021-\u007e]/u.test(decoded)
      ) {
        return undefined;
      }
      token = decoded;
    } catch {
      return undefined;
    }
  }
  return token;
}

/**
 * Remove the platform `authToken` pair from a Cookie header before a request
 * crosses into tenant-controlled project code. The cookie carries a Veryfront
 * credential (a user session JWT, or an exchanged environment access token);
 * the proxy consumes it via {@linkcode extractUserToken} and forwards the
 * resolved identity through `x-token`, so the raw credential must never be
 * observable by deployed pages, API routes, or middleware. Every other cookie
 * is preserved verbatim for the application. Returns `undefined` when nothing
 * remains.
 */
export function stripUserTokenCookie(cookieHeader: string): string | undefined {
  const kept: string[] = [];
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (trimmed === "") continue;
    const separatorIndex = trimmed.indexOf("=");
    const name = separatorIndex === -1 ? trimmed : trimmed.slice(0, separatorIndex).trim();
    if (name === "authToken") continue;
    kept.push(trimmed);
  }
  if (kept.length === 0) return undefined;
  return kept.join("; ");
}

/**
 * Token service deployments report an unknown project identity with either
 * HTTP 400 (legacy) or HTTP 404. Classify that contract at the typed HTTP
 * boundary without coupling the proxy to response prose.
 */
export function isMissingProxyProjectError(error: unknown): boolean {
  try {
    return error instanceof OAuthTokenRequestError &&
      (error.status === 400 || error.status === 404);
  } catch {
    return false;
  }
}

export async function resolveProxyRequestToken(
  options: ResolveProxyRequestTokenOptions,
): Promise<ResolvedProxyRequestToken> {
  const {
    config,
    host,
    logger,
    projectSlug,
    req,
    scope,
    tokenFetchErrorMessage,
    tokenManager,
    url,
  } = options;
  const userToken = extractUserToken(req.headers.get("cookie") ?? "");
  const useSignedInternalControlPlaneToken = options.allowSignedInternalControlPlaneToken &&
    options.signedInternalControlPlaneRequest;
  const tokenStrategy = options.tokenStrategy ?? "preview-user-first";
  const useUserTokenForPreview = tokenStrategy === "preview-user-first";

  let token: string | undefined;
  let tokenSource: ResolvedProxyRequestToken["tokenSource"];
  let tokenFetchError: unknown;

  if (useSignedInternalControlPlaneToken) {
    token = req.headers.get("x-token") ?? undefined;
    if (token) tokenSource = "signed-internal";
    logger?.debug("Using signed control-plane token for internal request", {
      pathname: url.pathname,
      scope,
    });
  } else if (scope === "preview" && userToken && useUserTokenForPreview) {
    token = userToken;
    tokenSource = "user";
    logger?.debug("Using user auth token for preview");
  }

  if (!token && config.apiClientId && config.apiClientSecret) {
    const customDomain = projectSlug ? undefined : host;
    if (projectSlug || customDomain) {
      try {
        token = await tokenManager.getToken(
          scope,
          projectSlug,
          customDomain,
          { signal: req.signal },
        );
        tokenSource = "service";
      } catch (error) {
        if (req.signal.aborted) throw createAbortError(req.signal.reason);
        tokenFetchError = error;
        if (!isMissingProxyProjectError(error)) {
          logger?.error(tokenFetchErrorMessage, error, {
            projectSlug,
            customDomain,
          });
        }
      }
    }
  }

  if (!token && config.apiToken) {
    token = config.apiToken;
    tokenSource = "static";
    logger?.debug("Using static API token fallback");
  }

  return { token, tokenSource, userToken, tokenFetchError };
}
