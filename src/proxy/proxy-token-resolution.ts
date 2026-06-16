import type { TokenScope } from "./token-manager.ts";

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
  ): Promise<string>;
}

export interface ProxyTokenResolutionLogger {
  debug: (msg: string, extra?: Record<string, unknown>) => void;
  info: (msg: string, extra?: Record<string, unknown>) => void;
  warn: (msg: string, extra?: Record<string, unknown>) => void;
  error: (msg: string, error?: Error, extra?: Record<string, unknown>) => void;
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
  tokenFetchErrorMessage: string;
}

export interface ResolvedProxyRequestToken {
  token?: string;
  tokenSource?: "signed-internal" | "user" | "service" | "static";
  userToken?: string;
  tokenFetchError?: unknown;
}

export function extractUserToken(cookieHeader: string): string | undefined {
  const match = cookieHeader.match(/(?:^|;\s*)authToken=([^;]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

// Brittle on purpose: the API currently returns this text when token minting
// cannot map a custom domain. Tracked in #2217 until a typed error code exists.
export function isMissingCustomDomainProjectError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /project not found for domain/i.test(message);
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
  } else if (scope === "preview" && userToken) {
    token = userToken;
    tokenSource = "user";
    logger?.debug("Using user auth token for preview");
  }

  if (!token && config.apiClientId && config.apiClientSecret) {
    const customDomain = projectSlug ? undefined : host;
    if (projectSlug || customDomain) {
      try {
        token = await tokenManager.getToken(scope, projectSlug, customDomain);
        tokenSource = "service";
      } catch (error) {
        tokenFetchError = error;
        if (!(customDomain && isMissingCustomDomainProjectError(error))) {
          logger?.error(tokenFetchErrorMessage, error as Error, {
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
