import { TokenManager, type TokenScope } from "./token-manager.ts";
import { OAuthTokenRequestError } from "./oauth-client.ts";
import { type ParsedDomain, parseProjectDomain } from "#veryfront/server/utils/domain-parser.ts";
import type { TokenCache } from "./cache/types.ts";
import { injectContext, ProxySpanNames, withSpan } from "./tracing.ts";
import { computeContentSourceId } from "#veryfront/cache/keys.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import { checkProtectedProxyAccess } from "./proxy-access-control.ts";
import { createLocalProjectResolver } from "./local-project-resolver.ts";
import {
  isMissingCustomDomainProjectError,
  resolveProxyRequestToken,
} from "./proxy-token-resolution.ts";
import {
  createProjectNotFoundProxyContext,
  createProxyErrorContext,
  createReleaseNotFoundProxyContext,
} from "./proxy-error-context.ts";
import { profileProxyServerTimingPhase, type ProxyServerTiming } from "./server-timing.ts";
import { isVerifiedInternalControlPlaneRequest } from "./control-plane-signature.ts";

export { __resetCachedAuthProviderForTests } from "./proxy-access-control.ts";

export const INTERNAL_PROXY_HEADERS = [
  "x-token",
  "x-project-slug",
  "x-environment",
  "x-environment-id",
  "x-content-source-id",
  "x-forwarded-host",
  "x-project-path",
  "x-project-id",
  "x-release-id",
  "x-branch-id",
  "x-branch-name",
] as const;

interface ProjectRoutingLookupResult {
  id: string;
  slug: string;
  name: string;
  environments?: Array<{
    id: string;
    name: string;
    domains?: string[];
    active_release_id?: string | null;
  }>;
}

interface ProjectAccessLookupResult {
  id: string;
  slug: string;
  users?: Array<{ id: string }>;
  environments?: Array<{
    id: string;
    name: string;
    domains?: string[];
    protected?: boolean;
  }>;
}

interface DomainLookupResult extends ProjectRoutingLookupResult {
  users?: Array<{ id: string }>;
  environments?: Array<{
    id: string;
    name: string;
    domains?: string[];
    active_release_id?: string | null;
    protected?: boolean;
  }>;
}

type ProjectLookupEnvironment = {
  id: string;
  name: string;
  domains?: string[];
};

interface ProjectRoutingCacheEntry {
  value: ProjectRoutingLookupResult;
  expiresAt: number;
}

const DEFAULT_PROXY_ROUTING_CACHE_TTL_MS = 60_000;
const DEFAULT_PROXY_ROUTING_CACHE_MAX_ENTRIES = 1_000;

function readNonNegativeIntegerEnv(name: string, fallback: number): number {
  const raw = getEnv(name);
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function normalizeProjectLookupKey(lookupKey: string): string {
  return lookupKey.trim().replace(/:\d+$/, "").toLowerCase();
}

type ProxyLookupType = "domain" | "routing" | "access";

class ProxyLookupAuthError extends Error {
  constructor(
    readonly lookupType: ProxyLookupType,
    readonly status: number,
  ) {
    super(`Proxy ${lookupType} lookup rejected service token: ${status}`);
    this.name = "ProxyLookupAuthError";
  }
}

function isProxyLookupAuthError(error: unknown): error is ProxyLookupAuthError {
  return error instanceof ProxyLookupAuthError;
}

function throwIfProxyLookupAuthFailure(status: number, lookupType: ProxyLookupType): void {
  if (status === 401 || status === 403) {
    throw new ProxyLookupAuthError(lookupType, status);
  }
}

async function lookupProjectByDomain(
  domain: string,
  apiBaseUrl: string,
  token: string,
  logger?: ProxyLogger,
): Promise<DomainLookupResult | null> {
  return withSpan(
    ProxySpanNames.PROXY_DOMAIN_LOOKUP,
    async () => {
      const domainWithoutPort = domain.replace(/:\d+$/, "");
      const url = `${apiBaseUrl}/projects/${encodeURIComponent(domainWithoutPort)}`;
      const urlObj = new URL(url);

      logger?.debug("Looking up project by domain", { domain, url });

      const headers = new Headers({
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      });
      injectContext(headers);

      try {
        const response = await withSpan(
          ProxySpanNames.HTTP_CLIENT_FETCH,
          () => fetch(url, { headers }),
          {
            "http.method": "GET",
            "http.url": url,
            "http.host": urlObj.host,
            "proxy.domain_lookup": domain,
          },
        );

        if (!response.ok) {
          await response.body?.cancel();
          if (response.status !== 404) {
            logger?.error("Domain lookup API error", undefined, {
              domain,
              status: response.status,
              statusText: response.statusText,
            });
          }
          throwIfProxyLookupAuthFailure(response.status, "domain");
          return null;
        }

        const result = (await response.json()) as DomainLookupResult;
        logger?.debug("Domain lookup successful", {
          domain,
          projectSlug: result.slug,
          environments: result.environments?.map((e) => e.name),
        });
        return result;
      } catch (error) {
        if (isProxyLookupAuthError(error)) throw error;
        logger?.error("Domain lookup failed", error as Error, { domain });
        return null;
      }
    },
    { "proxy.domain": domain },
  );
}

async function lookupProjectRoutingMetadata(
  lookupKey: string,
  apiBaseUrl: string,
  token: string,
  logger?: ProxyLogger,
): Promise<ProjectRoutingLookupResult | null> {
  return withSpan(
    ProxySpanNames.PROXY_DOMAIN_LOOKUP,
    async () => {
      const normalizedLookupKey = normalizeProjectLookupKey(lookupKey);
      const url = `${apiBaseUrl}/projects/-/proxy-routing/${
        encodeURIComponent(normalizedLookupKey)
      }`;
      const urlObj = new URL(url);

      logger?.debug("Looking up project proxy routing metadata", { lookupKey, url });

      const headers = new Headers({
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      });
      injectContext(headers);

      try {
        const response = await withSpan(
          ProxySpanNames.HTTP_CLIENT_FETCH,
          () => fetch(url, { headers }),
          {
            "http.method": "GET",
            "http.url": url,
            "http.host": urlObj.host,
            "proxy.routing_lookup": normalizedLookupKey,
          },
        );

        if (!response.ok) {
          await response.body?.cancel();
          if (response.status !== 404) {
            logger?.error("Proxy routing metadata API error", undefined, {
              lookupKey,
              status: response.status,
              statusText: response.statusText,
            });
          }
          throwIfProxyLookupAuthFailure(response.status, "routing");
          return null;
        }

        const result = (await response.json()) as ProjectRoutingLookupResult;
        logger?.debug("Proxy routing metadata lookup successful", {
          lookupKey,
          projectSlug: result.slug,
          environments: result.environments?.map((e) => e.name),
        });
        return result;
      } catch (error) {
        if (isProxyLookupAuthError(error)) throw error;
        logger?.error("Proxy routing metadata lookup failed", error as Error, { lookupKey });
        return null;
      }
    },
    { "proxy.lookup_key": lookupKey },
  );
}

async function lookupProjectAccessMetadata(
  lookupKey: string,
  apiBaseUrl: string,
  token: string,
  includeUsers: boolean,
  logger?: ProxyLogger,
): Promise<ProjectAccessLookupResult | null> {
  return withSpan(
    ProxySpanNames.PROXY_DOMAIN_LOOKUP,
    async () => {
      const normalizedLookupKey = normalizeProjectLookupKey(lookupKey);
      const url = `${apiBaseUrl}/projects/-/proxy-access/${
        encodeURIComponent(normalizedLookupKey)
      }?include_users=${includeUsers ? "true" : "false"}`;
      const urlObj = new URL(url);

      logger?.debug("Looking up project proxy access metadata", { lookupKey, includeUsers, url });

      const headers = new Headers({
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      });
      injectContext(headers);

      try {
        const response = await withSpan(
          ProxySpanNames.HTTP_CLIENT_FETCH,
          () => fetch(url, { headers }),
          {
            "http.method": "GET",
            "http.url": url,
            "http.host": urlObj.host,
            "proxy.access_lookup": normalizedLookupKey,
          },
        );

        if (!response.ok) {
          await response.body?.cancel();
          if (response.status !== 404) {
            logger?.error("Proxy access metadata API error", undefined, {
              lookupKey,
              status: response.status,
              statusText: response.statusText,
            });
          }
          throwIfProxyLookupAuthFailure(response.status, "access");
          return null;
        }

        const result = (await response.json()) as ProjectAccessLookupResult;
        logger?.debug("Proxy access metadata lookup successful", {
          lookupKey,
          projectSlug: result.slug,
          environments: result.environments?.map((e) => e.name),
          userCount: result.users?.length ?? 0,
        });
        return result;
      } catch (error) {
        if (isProxyLookupAuthError(error)) throw error;
        logger?.error("Proxy access metadata lookup failed", error as Error, { lookupKey });
        return null;
      }
    },
    { "proxy.lookup_key": lookupKey },
  );
}

export interface ProxyConfig {
  apiBaseUrl: string;
  apiClientId: string;
  apiClientSecret: string;
  previewApiClientId: string;
  previewApiClientSecret: string;
  apiToken?: string;
  localProjects?: Record<string, string>;
}

export interface ProxyContext {
  token?: string;
  projectSlug?: string;
  projectId?: string;
  releaseId?: string;
  branchId?: string;
  branchName?: string;
  environmentId?: string;
  environment: "preview" | "production";
  contentSourceId: string;
  localPath?: string;
  host: string;
  parsedDomain: ParsedDomain;
  isLocalProject: boolean;
  error?: {
    status: number;
    message: string;
    slug?: string;
    redirectUrl?: string;
  };
}

type ResolvedProjectMetadata =
  | { projectId?: string; projectSlug?: string; releaseId?: string; environmentId?: string }
  | { error: { status: number; message: string; redirectUrl?: string } };

export interface ProxyLogger {
  debug: (msg: string, extra?: Record<string, unknown>) => void;
  info: (msg: string, extra?: Record<string, unknown>) => void;
  warn: (msg: string, extra?: Record<string, unknown>) => void;
  error: (msg: string, error?: Error, extra?: Record<string, unknown>) => void;
}

export interface ProxyHandlerOptions {
  config: ProxyConfig;
  cache?: TokenCache;
  logger?: ProxyLogger;
}

export interface ProxyRequestOptions {
  url?: URL;
  timing?: ProxyServerTiming;
}

function getRequestHost(req: Request, url: URL): string {
  return req.headers.get("host") ?? url.host;
}

function getScope(environment: string | null): TokenScope {
  return environment === "preview" ? "preview" : "production";
}

function parseStatusFromError(error: unknown): number | null {
  // Prefer the structured status carried by the token error (both fresh and
  // negatively-cached token failures surface as OAuthTokenRequestError).
  if (error instanceof OAuthTokenRequestError) return error.status;

  // Defensive fallback for errors from other layers that only embed the status
  // in their message text.
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/failed: (\d+)/);
  return match ? Number(match[1]) : null;
}

export function createProxyHandler(options: ProxyHandlerOptions) {
  const { config, cache, logger } = options;
  const localProjects = config.localProjects ?? {};
  const localProjectResolver = createLocalProjectResolver({ localProjects, logger });

  const tokenManager = new TokenManager(
    {
      apiBaseUrl: config.apiBaseUrl,
      apiClientId: config.apiClientId,
      apiClientSecret: config.apiClientSecret,
      previewApiClientId: config.previewApiClientId,
      previewApiClientSecret: config.previewApiClientSecret,
    },
    { cache },
  );
  const routingCacheTtlMs = readNonNegativeIntegerEnv(
    "VERYFRONT_PROXY_ROUTING_CACHE_TTL_MS",
    DEFAULT_PROXY_ROUTING_CACHE_TTL_MS,
  );
  const routingCacheMaxEntries = readNonNegativeIntegerEnv(
    "VERYFRONT_PROXY_ROUTING_CACHE_MAX_ENTRIES",
    DEFAULT_PROXY_ROUTING_CACHE_MAX_ENTRIES,
  );
  const routingLookupCache = new Map<string, ProjectRoutingCacheEntry>();
  const routingLookupInflight = new Map<string, Promise<ProjectRoutingLookupResult | null>>();

  async function resolveProjectLookup(
    lookupKey: string,
    token: string,
    timing?: ProxyServerTiming,
  ): Promise<DomainLookupResult | null> {
    return await profileProxyServerTimingPhase(
      timing ?? { enabled: false, startedAt: 0, phases: new Map() },
      "proxy.project_lookup",
      () => lookupProjectByDomain(lookupKey, config.apiBaseUrl, token, logger),
    );
  }

  function getCachedRoutingLookup(cacheKey: string): ProjectRoutingLookupResult | null {
    if (routingCacheTtlMs <= 0 || routingCacheMaxEntries <= 0) {
      return null;
    }

    const cached = routingLookupCache.get(cacheKey);
    if (!cached) {
      return null;
    }

    if (cached.expiresAt <= Date.now()) {
      routingLookupCache.delete(cacheKey);
      return null;
    }

    routingLookupCache.delete(cacheKey);
    routingLookupCache.set(cacheKey, cached);
    return cached.value;
  }

  function setCachedRoutingLookup(cacheKey: string, value: ProjectRoutingLookupResult): void {
    if (routingCacheTtlMs <= 0 || routingCacheMaxEntries <= 0) {
      return;
    }

    if (!routingLookupCache.has(cacheKey)) {
      while (routingLookupCache.size >= routingCacheMaxEntries) {
        const oldestKey = routingLookupCache.keys().next().value;
        if (!oldestKey) break;
        routingLookupCache.delete(oldestKey);
      }
    }

    routingLookupCache.set(cacheKey, {
      value,
      expiresAt: Date.now() + routingCacheTtlMs,
    });
  }

  async function resolveProjectRoutingLookup(
    lookupKey: string,
    token: string,
    timing?: ProxyServerTiming,
  ): Promise<ProjectRoutingLookupResult | null> {
    const cacheKey = normalizeProjectLookupKey(lookupKey);
    return await profileProxyServerTimingPhase(
      timing ?? { enabled: false, startedAt: 0, phases: new Map() },
      "proxy.routing_lookup",
      async () => {
        const cached = getCachedRoutingLookup(cacheKey);
        if (cached) {
          logger?.debug("Proxy routing metadata cache hit", { lookupKey });
          return cached;
        }

        const existingLookup = routingLookupInflight.get(cacheKey);
        if (existingLookup) {
          logger?.debug("Proxy routing metadata lookup joined in-flight request", { lookupKey });
          return await existingLookup;
        }

        const lookupPromise = lookupProjectRoutingMetadata(
          lookupKey,
          config.apiBaseUrl,
          token,
          logger,
        )
          .then((result) => {
            if (result) {
              setCachedRoutingLookup(cacheKey, result);
            }
            return result;
          })
          .finally(() => {
            routingLookupInflight.delete(cacheKey);
          });
        routingLookupInflight.set(cacheKey, lookupPromise);
        return await lookupPromise;
      },
    );
  }

  async function resolveProjectAccessLookup(
    lookupKey: string,
    token: string,
    includeUsers: boolean,
    timing?: ProxyServerTiming,
  ): Promise<ProjectAccessLookupResult | null> {
    return await profileProxyServerTimingPhase(
      timing ?? { enabled: false, startedAt: 0, phases: new Map() },
      "proxy.access_lookup",
      () => lookupProjectAccessMetadata(lookupKey, config.apiBaseUrl, token, includeUsers, logger),
    );
  }

  function validateConfig(): string[] {
    const missing: string[] = [];
    if (!config.apiClientId) missing.push("VERYFRONT_PROXY_API_CLIENT_ID");
    if (!config.apiClientSecret) missing.push("VERYFRONT_PROXY_API_CLIENT_SECRET");
    return missing;
  }

  async function resolveFullProjectLookupAndProtection(
    req: Request,
    url: URL,
    token: string,
    userToken: string | undefined,
    lookupKey: string,
    envMatcher: (env: ProjectLookupEnvironment) => boolean,
    timing: ProxyServerTiming | undefined,
    logContext: Record<string, unknown>,
    signedInternalControlPlaneRequest: boolean,
  ): Promise<ResolvedProjectMetadata> {
    const lookupResult = await resolveProjectLookup(lookupKey, token, timing);
    if (!lookupResult) return { projectId: undefined, releaseId: undefined };

    const matchingEnv = lookupResult.environments?.find(envMatcher);

    const protectionError = await checkProtectedProxyAccess({
      req,
      url,
      matchingEnv,
      userToken,
      users: lookupResult.users,
      apiBaseUrl: config.apiBaseUrl,
      logger,
      logContext,
      isSignedInternalControlPlaneRequest: signedInternalControlPlaneRequest,
    });
    if (protectionError) return { error: protectionError };

    return {
      projectId: lookupResult.id,
      projectSlug: lookupResult.slug,
      releaseId: matchingEnv?.active_release_id ?? undefined,
      environmentId: matchingEnv?.id,
    };
  }

  async function resolveProjectMetadataAndProtection(
    req: Request,
    url: URL,
    token: string,
    userToken: string | undefined,
    lookupKey: string,
    envMatcher: (env: ProjectLookupEnvironment) => boolean,
    timing: ProxyServerTiming | undefined,
    logContext: Record<string, unknown>,
    signedInternalControlPlaneRequest: boolean,
  ): Promise<ResolvedProjectMetadata> {
    return await profileProxyServerTimingPhase(
      timing ?? { enabled: false, startedAt: 0, phases: new Map() },
      "proxy.project_lookup",
      async () => {
        const routingResult = await resolveProjectRoutingLookup(lookupKey, token, timing);
        if (!routingResult) {
          return await resolveFullProjectLookupAndProtection(
            req,
            url,
            token,
            userToken,
            lookupKey,
            envMatcher,
            undefined,
            logContext,
            signedInternalControlPlaneRequest,
          );
        }

        const accessResult = await resolveProjectAccessLookup(
          lookupKey,
          token,
          !!userToken,
          timing,
        );
        if (!accessResult || accessResult.id !== routingResult.id) {
          routingLookupCache.delete(normalizeProjectLookupKey(lookupKey));
          return await resolveFullProjectLookupAndProtection(
            req,
            url,
            token,
            userToken,
            lookupKey,
            envMatcher,
            undefined,
            logContext,
            signedInternalControlPlaneRequest,
          );
        }

        const routingEnv = routingResult.environments?.find(envMatcher);
        const accessEnv = accessResult.environments?.find(envMatcher);

        const protectionError = await checkProtectedProxyAccess({
          req,
          url,
          matchingEnv: accessEnv,
          userToken,
          users: accessResult.users,
          apiBaseUrl: config.apiBaseUrl,
          logger,
          logContext,
          isSignedInternalControlPlaneRequest: signedInternalControlPlaneRequest,
        });
        if (protectionError) return { error: protectionError };

        return {
          projectId: routingResult.id,
          projectSlug: routingResult.slug,
          releaseId: routingEnv?.active_release_id ?? undefined,
          environmentId: routingEnv?.id,
        };
      },
    );
  }

  async function processRequest(
    req: Request,
    options: ProxyRequestOptions = {},
  ): Promise<ProxyContext> {
    const url = options.url ?? new URL(req.url);
    const rawHost = getRequestHost(req, url);
    const host = rawHost.replace(/:\d+$/, "");
    const parsedDomain = parseProjectDomain(host);
    const scope = getScope(parsedDomain.environment);
    const base = { scope, host, parsedDomain };

    // Verify the control-plane/dispatch signature once per request. This gates
    // both the protected-environment access bypass and the x-token forwarding
    // below, so it must be a real cryptographic check, not header presence.
    const signedInternalControlPlaneRequest = await isVerifiedInternalControlPlaneRequest(
      req,
      url,
    );

    let projectSlug = parsedDomain.slug ?? undefined;
    let projectId: string | undefined;
    let releaseId: string | undefined;
    let environmentId: string | undefined;

    const isCustomDomain = !projectSlug && !parsedDomain.isVeryfrontDomain;

    if (!projectSlug && parsedDomain.isVeryfrontDomain) {
      return {
        token: undefined,
        projectSlug: undefined,
        projectId: undefined,
        environment: "preview",
        contentSourceId: "no-project",
        localPath: undefined,
        host,
        parsedDomain,
        isLocalProject: false,
      };
    }

    const localPath = projectSlug ? await localProjectResolver.find(projectSlug) : undefined;
    const isLocalProject = !!localPath;

    logger?.debug("Processing request", {
      host,
      projectSlug,
      environment: scope,
      isLocalProject,
      isCustomDomain,
    });

    let userToken: string | undefined;
    let token: string | undefined;
    let tokenSource: "signed-internal" | "user" | "service" | "static" | undefined;
    let metadataToken: string | undefined;
    let tokenFetchError: unknown;

    async function resolveProjectMetadataWithTokenRetry(
      lookupKey: string,
      envMatcher: (env: ProjectLookupEnvironment) => boolean,
      timing: ProxyServerTiming | undefined,
      logContext: Record<string, unknown>,
      tokenIdentity: { projectSlug?: string; customDomain?: string },
    ): Promise<ResolvedProjectMetadata> {
      if (!metadataToken) {
        return { error: { status: 502, message: "Proxy API token unavailable" } };
      }

      const resolveWithCurrentToken = () =>
        resolveProjectMetadataAndProtection(
          req,
          url,
          metadataToken!,
          userToken,
          lookupKey,
          envMatcher,
          timing,
          logContext,
          signedInternalControlPlaneRequest,
        );

      try {
        return await resolveWithCurrentToken();
      } catch (error) {
        if (!isProxyLookupAuthError(error)) throw error;

        const projectKey = tokenIdentity.projectSlug ?? tokenIdentity.customDomain;
        logger?.warn("Proxy API token rejected during metadata lookup; refreshing token", {
          lookupKey,
          host,
          scope,
          projectSlug: tokenIdentity.projectSlug,
          customDomain: tokenIdentity.customDomain,
          status: error.status,
          lookupType: error.lookupType,
        });

        routingLookupCache.delete(normalizeProjectLookupKey(lookupKey));
        await tokenManager.invalidateToken(scope, projectKey);

        try {
          metadataToken = await tokenManager.getToken(
            scope,
            tokenIdentity.projectSlug,
            tokenIdentity.customDomain,
          );
          if (tokenSource !== "user" && tokenSource !== "signed-internal") {
            token = metadataToken;
          }
        } catch (refreshError) {
          logger?.error(
            "Failed to refresh proxy API token after metadata auth rejection",
            refreshError as Error,
            {
              lookupKey,
              host,
              scope,
              projectSlug: tokenIdentity.projectSlug,
              customDomain: tokenIdentity.customDomain,
            },
          );
          return { error: { status: 502, message: "Failed to refresh proxy API token" } };
        }

        try {
          return await resolveWithCurrentToken();
        } catch (retryError) {
          if (!isProxyLookupAuthError(retryError)) throw retryError;

          logger?.error("Proxy API token rejected after refresh", retryError, {
            lookupKey,
            host,
            scope,
            projectSlug: tokenIdentity.projectSlug,
            customDomain: tokenIdentity.customDomain,
            status: retryError.status,
            lookupType: retryError.lookupType,
          });
          return { error: { status: 502, message: "Proxy API token rejected by API" } };
        }
      }
    }

    if (isLocalProject) {
      logger?.debug("Local project, skipping token fetch", { localPath });
    } else {
      ({ token, tokenSource, userToken, tokenFetchError } = await resolveProxyRequestToken(
        {
          req,
          url,
          scope,
          host,
          projectSlug,
          config,
          tokenManager,
          logger,
          allowSignedInternalControlPlaneToken: true,
          signedInternalControlPlaneRequest,
          tokenStrategy: "service-first",
          tokenFetchErrorMessage: "Token fetch failed",
        },
      ));
      metadataToken = token;

      if (tokenSource === "user" && config.apiClientId && config.apiClientSecret) {
        const customDomain = projectSlug ? undefined : host;
        metadataToken = undefined;
        try {
          metadataToken = await tokenManager.getToken(scope, projectSlug, customDomain);
        } catch (error) {
          tokenFetchError = error;
          if (!isMissingCustomDomainProjectError(error)) {
            logger?.error("Metadata service token fetch failed", error as Error, {
              projectSlug,
              customDomain,
            });
          }
        }
      }

      if (projectSlug && !token) {
        const status = parseStatusFromError(tokenFetchError);
        if (status === 404 || isMissingCustomDomainProjectError(tokenFetchError)) {
          if (scope === "preview") {
            logger?.info("Preview project not found", { projectSlug, host });
            return createProjectNotFoundProxyContext(base, "Preview project not found");
          }

          logger?.info("Project not found", { projectSlug, host, scope });
          return createProjectNotFoundProxyContext(base, "Project not found");
        }

        const message = scope === "preview"
          ? "Failed to authenticate preview request"
          : "Failed to authenticate project request";

        logger?.warn("Project request has no usable token", {
          projectSlug,
          host,
          scope,
          hadUserToken: !!userToken,
          hadTokenFetchError: !!tokenFetchError,
        });
        return createProxyErrorContext(base, { status: 502, message });
      }

      if (projectSlug && tokenSource === "user" && !metadataToken) {
        const status = parseStatusFromError(tokenFetchError);
        if (status === 404 || isMissingCustomDomainProjectError(tokenFetchError)) {
          if (scope === "preview") {
            logger?.info("Preview project not found", { projectSlug, host });
            return createProjectNotFoundProxyContext(base, "Preview project not found", token);
          }

          logger?.info("Project not found", { projectSlug, host, scope });
          return createProjectNotFoundProxyContext(base, "Project not found", token);
        }
      }

      if (isCustomDomain && !projectSlug) {
        if (!token) {
          if (isMissingCustomDomainProjectError(tokenFetchError)) {
            logger?.info("Custom domain project not found during token fetch", {
              domain: host,
            });
            return createProxyErrorContext(base, {
              status: 404,
              message: `No project configured for domain: ${host}`,
            });
          }

          logger?.error("Cannot process custom domain without token", undefined, { domain: host });
          return createProxyErrorContext(base, {
            status: 502,
            message: `Failed to authenticate for domain: ${host}`,
            token,
          });
        }

        const normalizedHost = host.toLowerCase().replace(/:\d+$/, "");
        const resolved = await resolveProjectMetadataWithTokenRetry(
          host,
          (env) => env.domains?.some((d) => d.toLowerCase() === normalizedHost) ?? false,
          options.timing,
          { domain: host },
          { customDomain: host },
        );

        if ("error" in resolved) {
          return createProxyErrorContext(base, {
            status: resolved.error.status,
            message: resolved.error.message,
            token,
            redirectUrl: resolved.error.redirectUrl,
          });
        }

        if (!resolved.projectId || !resolved.projectSlug) {
          logger?.info("Custom domain not found", { domain: host });
          return createProxyErrorContext(base, {
            status: 404,
            message: `No project configured for domain: ${host}`,
            token,
          });
        }

        projectSlug = resolved.projectSlug;
        projectId = resolved.projectId;
        releaseId = resolved.releaseId;
        environmentId = resolved.environmentId;

        logger?.info("Resolved custom domain to project", {
          domain: host,
          projectSlug,
          projectId,
          releaseId,
          environmentId,
        });
      } else if (projectSlug && scope === "production" && token && parsedDomain.environment) {
        const targetEnv = parsedDomain.environment.toLowerCase();

        const resolved = await resolveProjectMetadataWithTokenRetry(
          projectSlug,
          (env) => env.name.toLowerCase() === targetEnv,
          options.timing,
          { projectSlug },
          { projectSlug },
        );

        if ("error" in resolved) {
          return createProxyErrorContext(base, {
            status: resolved.error.status,
            message: resolved.error.message,
            token,
            redirectUrl: resolved.error.redirectUrl,
          });
        }

        if (!resolved.projectId) {
          logger?.info("Project not found after lookup", {
            projectSlug,
            host,
            scope,
            targetEnvName: parsedDomain.environment,
          });
          return createProjectNotFoundProxyContext(base, "Project not found", token);
        }

        projectId = resolved.projectId;
        releaseId = resolved.releaseId;
        environmentId = resolved.environmentId;

        logger?.info("Resolved veryfront domain to project", {
          projectSlug,
          projectId,
          releaseId,
          environmentId,
          targetEnvName: parsedDomain.environment,
        });
      } else if (projectSlug && scope === "preview" && token) {
        // Preview uses branch-based content (no releaseId needed), but must
        // still enforce the environment's `protected` flag like other scopes.
        const resolved = await resolveProjectMetadataWithTokenRetry(
          projectSlug,
          (env) => env.name.toLowerCase() === "preview",
          options.timing,
          { projectSlug },
          { projectSlug },
        );

        if ("error" in resolved) {
          return createProxyErrorContext(base, {
            status: resolved.error.status,
            message: resolved.error.message,
            token,
            redirectUrl: resolved.error.redirectUrl,
          });
        }

        if (!resolved.projectId) {
          logger?.info("Preview project not found after lookup", { projectSlug, host });
          return createProjectNotFoundProxyContext(base, "Preview project not found", token);
        }

        projectId = resolved.projectId;
        environmentId = resolved.environmentId;

        if (projectId) {
          logger?.info("Resolved preview project", {
            projectSlug,
            projectId,
            environmentId,
          });
        }
      }
    }

    if (scope === "production" && projectSlug && !releaseId && !isLocalProject) {
      logger?.warn("No active release found", {
        projectSlug,
        projectId,
        host,
        environment: scope,
      });
      return createReleaseNotFoundProxyContext({ scope, host, parsedDomain }, token);
    }

    const contentSourceId = computeContentSourceId(
      isLocalProject,
      scope,
      parsedDomain.branch,
      releaseId,
    );

    return {
      token,
      projectSlug,
      projectId,
      releaseId,
      environmentId,
      contentSourceId,
      environment: scope,
      localPath,
      host,
      parsedDomain,
      isLocalProject,
    };
  }

  async function getTokenForApi(
    req: Request,
    options: ProxyRequestOptions = {},
  ): Promise<string | undefined> {
    const url = options.url ?? new URL(req.url);
    const rawHost = getRequestHost(req, url);
    const host = rawHost.replace(/:\d+$/, "");
    const parsedDomain = parseProjectDomain(host);
    const scope = getScope(parsedDomain.environment);
    const projectSlug = parsedDomain.slug ?? undefined;
    const { token } = await resolveProxyRequestToken({
      req,
      url,
      scope,
      host,
      projectSlug,
      config,
      tokenManager,
      logger,
      signedInternalControlPlaneRequest: await isVerifiedInternalControlPlaneRequest(req, url),
      tokenFetchErrorMessage: "Token fetch failed for API",
    });
    return token;
  }

  async function getStats() {
    return tokenManager.getStats();
  }

  async function close() {
    await tokenManager.close();
  }

  return {
    processRequest,
    getTokenForApi,
    getStats,
    close,
    validateConfig,
    localProjects,
  };
}

export type ProxyHandler = ReturnType<typeof createProxyHandler>;

export function injectContextHeaders(req: Request, ctx: ProxyContext): Request {
  const headers = new Headers(req.headers);
  for (const header of INTERNAL_PROXY_HEADERS) headers.delete(header);

  // The `x-veryfront-*-jws` signature headers are deliberately NOT stripped:
  // the downstream renderer re-verifies them against the raw request body and
  // project audience (`verifyDispatchJws` / `verifyControlPlaneJws`). Since the
  // proxy now trusts these headers only after cryptographic verification (see
  // isVerifiedInternalControlPlaneRequest), forwarding an unverified/forged one
  // is harmless — the renderer rejects it.

  if (ctx.token) headers.set("x-token", ctx.token);
  headers.set("x-project-slug", ctx.projectSlug ?? "");
  headers.set("x-environment", ctx.environment);
  headers.set("x-content-source-id", ctx.contentSourceId);
  headers.set("x-forwarded-host", ctx.host);
  if (ctx.localPath) headers.set("x-project-path", ctx.localPath);

  if (ctx.projectId) headers.set("x-project-id", ctx.projectId);
  if (ctx.releaseId) headers.set("x-release-id", ctx.releaseId);
  if (ctx.environmentId) headers.set("x-environment-id", ctx.environmentId);

  if (ctx.branchId) headers.set("x-branch-id", ctx.branchId);
  if (ctx.branchName) headers.set("x-branch-name", ctx.branchName);

  return new Request(req.url, {
    method: req.method,
    headers,
    body: req.body,
    redirect: "manual",
  });
}
