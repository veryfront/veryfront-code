import { MissingCustomDomainProjectError, type TokenScope } from "./token-manager.ts";
export type { TokenScope } from "./token-manager.ts";

/** Credentials available to the proxy token-selection policy. */
export interface ProxyTokenResolutionConfig {
  /** Service-account client identifier. */
  apiClientId: string;
  /** Service-account client secret. */
  apiClientSecret: string;
  /** Optional static token used after service-token resolution. */
  apiToken?: string;
}

/** Minimum token-manager capability required by request token resolution. */
export interface ProxyTokenManager {
  /** Resolve a service token for a scope and optional project identity. */
  getToken(
    scope: TokenScope,
    projectSlug?: string,
    customDomain?: string,
  ): Promise<string>;
}

/** Logger contract used while selecting a proxy token. */
export interface ProxyTokenResolutionLogger {
  /** Write diagnostic context. */
  debug: (msg: string, extra?: Record<string, unknown>) => void;
  /** Write normal operational context. */
  info: (msg: string, extra?: Record<string, unknown>) => void;
  /** Write recoverable failure context. */
  warn: (msg: string, extra?: Record<string, unknown>) => void;
  /** Write a contained error and sanitized context. */
  error: (msg: string, error?: Error, extra?: Record<string, unknown>) => void;
}

/** Inputs used to choose the token forwarded for one proxy request. */
export interface ResolveProxyRequestTokenOptions {
  /** Inbound request. */
  req: Request;
  /** Parsed inbound request URL. */
  url: URL;
  /** Runtime token scope. */
  scope: TokenScope;
  /** Normalized request host. */
  host: string;
  /** Parsed project slug, when present. */
  projectSlug: string | undefined;
  /** Available credential sources. */
  config: ProxyTokenResolutionConfig;
  /** Service-token resolver. */
  tokenManager: ProxyTokenManager;
  /** Optional structured logger. */
  logger?: ProxyTokenResolutionLogger;
  /** Whether a verified internal token may be forwarded. */
  allowSignedInternalControlPlaneToken?: boolean;
  /** Whether the request carries a verified internal signature. */
  signedInternalControlPlaneRequest?: boolean;
  /** Ordering policy for preview user and service tokens. */
  tokenStrategy?: "preview-user-first" | "service-first";
  /** Safe log message used when service-token resolution fails. */
  tokenFetchErrorMessage: string;
}

/** Token-selection result for one proxy request. */
export interface ResolvedProxyRequestToken {
  /** Selected bounded token. */
  token?: string;
  /** Credential source that supplied the selected token. */
  tokenSource?: "signed-internal" | "user" | "service" | "static";
  /** Bounded user token extracted from the request cookie. */
  userToken?: string;
  /** Service-token error retained for typed request classification. */
  tokenFetchError?: unknown;
}

const MAX_PROXY_AUTH_TOKEN_LENGTH = 16_384;
const MAX_PROXY_COOKIE_HEADER_LENGTH = 65_536;
const MAX_PROXY_UPSTREAM_TOKEN_LENGTH = 65_536;

function usableUpstreamToken(value: string | null | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 &&
      value.length <= MAX_PROXY_UPSTREAM_TOKEN_LENGTH
    ? value
    : undefined;
}

/** Extract and decode a bounded auth token from a Cookie header. */
export function extractUserToken(cookieHeader: string): string | undefined {
  if (cookieHeader.length > MAX_PROXY_COOKIE_HEADER_LENGTH) return undefined;
  const match = cookieHeader.match(/(?:^|;\s*)authToken=([^;]+)/);
  const encoded = match?.[1];
  if (!encoded || encoded.length > MAX_PROXY_AUTH_TOKEN_LENGTH) return undefined;

  try {
    const decoded = decodeURIComponent(encoded);
    return decoded.length <= MAX_PROXY_AUTH_TOKEN_LENGTH ? decoded : undefined;
  } catch {
    return undefined;
  }
}

/** Return whether token minting failed because a custom domain has no project. */
export function isMissingCustomDomainProjectError(error: unknown): boolean {
  return error instanceof MissingCustomDomainProjectError;
}

/** Select a bounded upstream token using the configured trust and priority policy. */
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
    token = usableUpstreamToken(req.headers.get("x-token"));
    if (token) {
      tokenSource = "signed-internal";
      logger?.debug("Using signed control-plane token for internal request", {
        pathname: url.pathname,
        scope,
      });
    }
  } else if (scope === "preview" && userToken && useUserTokenForPreview) {
    token = userToken;
    tokenSource = "user";
    logger?.debug("Using user auth token for preview");
  }

  if (!token && config.apiClientId && config.apiClientSecret) {
    const customDomain = projectSlug ? undefined : host;
    if (projectSlug || customDomain) {
      try {
        token = usableUpstreamToken(
          await tokenManager.getToken(scope, projectSlug, customDomain),
        );
        if (token) tokenSource = "service";
      } catch (error) {
        tokenFetchError = error;
        if (!isMissingCustomDomainProjectError(error)) {
          logger?.error(tokenFetchErrorMessage, error as Error, {
            projectSlug,
            customDomain,
          });
        }
      }
    }
  }

  if (!token && config.apiToken) {
    token = usableUpstreamToken(config.apiToken);
    if (token) {
      tokenSource = "static";
      logger?.debug("Using static API token fallback");
    } else {
      logger?.warn("Ignoring static API token outside the allowed size range");
    }
  }

  return { token, tokenSource, userToken, tokenFetchError };
}
