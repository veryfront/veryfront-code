import { TokenManager, type TokenScope } from "./token-manager.ts";
import { type ParsedDomain, parseProjectDomain } from "#veryfront/server/utils/domain-parser.ts";
import type { TokenCache } from "./cache/types.ts";
import { injectContext, ProxySpanNames, withSpan } from "./tracing.ts";
import { computeContentSourceId } from "#veryfront/cache/keys.ts";
import { checkProtectedProxyAccess } from "./proxy-access-control.ts";
import { createLocalProjectResolver } from "./local-project-resolver.ts";
import {
  isMissingCustomDomainProjectError,
  type ResolvedProxyRequestToken,
  resolveProxyRequestToken,
} from "./proxy-token-resolution.ts";
import {
  createProjectNotFoundProxyContext,
  createProxyErrorContext,
  createReleaseNotFoundProxyContext,
} from "./proxy-error-context.ts";
import {
  markProxyServerTimingPhase,
  profileProxyServerTimingPhase,
  type ProxyServerTiming,
} from "./server-timing.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";

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

const INTERNAL_CONTROL_PLANE_SIGNATURE_HEADERS = [
  "x-veryfront-control-plane-jws",
  "x-veryfront-dispatch-jws",
] as const;

const DEFAULT_PROJECT_LOOKUP_CACHE_TTL_MS = 30_000;
const DEFAULT_PROJECT_LOOKUP_CACHE_MAX_ENTRIES = 1_000;

function isInternalControlPlanePath(pathname: string): boolean {
  return pathname === "/channels/invoke" ||
    pathname.startsWith("/api/control-plane/") ||
    pathname.startsWith("/internal/tasks/") ||
    pathname.startsWith("/internal/workflows/");
}

function isSignedInternalControlPlaneRequest(req: Request, url: URL): boolean {
  const pathname = url.pathname;
  if (!isInternalControlPlanePath(pathname)) {
    return false;
  }

  const hasSignature = INTERNAL_CONTROL_PLANE_SIGNATURE_HEADERS.some((header) =>
    !!req.headers.get(header)
  );
  if (!hasSignature) {
    return false;
  }

  return !!req.headers.get("x-token");
}

interface DomainLookupResult {
  id: string;
  slug: string;
  name: string;
  users?: Array<{ id: string }>;
  environments?: Array<{
    id: string;
    name: string;
    domains?: string[];
    active_release_id?: string | null;
    protected?: boolean;
  }>;
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
        logger?.error("Domain lookup failed", error as Error, { domain });
        return null;
      }
    },
    { "proxy.domain": domain },
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

interface ProjectLookupCacheEntry {
  value: DomainLookupResult;
  expiresAt: number;
}

function getRequestHost(req: Request, url: URL): string {
  return req.headers.get("host") ?? url.host;
}

function getScope(environment: string | null): TokenScope {
  return environment === "preview" ? "preview" : "production";
}

function parseStatusFromError(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/failed: (\d+)/);
  return match ? Number(match[1]) : null;
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = getEnv(name);
  if (!raw) return fallback;

  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Math.floor(value);
}

function normalizeProjectLookupCacheKey(lookupKey: string): string {
  return lookupKey.toLowerCase().replace(/:\d+$/, "");
}

export function createProxyHandler(options: ProxyHandlerOptions) {
  const { config, cache, logger } = options;
  const localProjects = config.localProjects ?? {};
  const localProjectResolver = createLocalProjectResolver({ localProjects, logger });
  const projectLookupCacheTtlMs = readPositiveIntegerEnv(
    "VERYFRONT_PROXY_PROJECT_LOOKUP_CACHE_TTL_MS",
    DEFAULT_PROJECT_LOOKUP_CACHE_TTL_MS,
  );
  const projectLookupCacheMaxEntries = readPositiveIntegerEnv(
    "VERYFRONT_PROXY_PROJECT_LOOKUP_CACHE_MAX_ENTRIES",
    DEFAULT_PROJECT_LOOKUP_CACHE_MAX_ENTRIES,
  );
  const projectLookupCache = new Map<string, ProjectLookupCacheEntry>();
  const pendingProjectLookups = new Map<string, Promise<DomainLookupResult | null>>();

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

  function canCacheProjectLookup(tokenSource: ResolvedProxyRequestToken["tokenSource"]): boolean {
    return projectLookupCacheTtlMs > 0 &&
      projectLookupCacheMaxEntries > 0 &&
      (tokenSource === "service" || tokenSource === "static");
  }

  function getCachedProjectLookup(cacheKey: string): DomainLookupResult | null {
    const entry = projectLookupCache.get(cacheKey);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      projectLookupCache.delete(cacheKey);
      return null;
    }

    projectLookupCache.delete(cacheKey);
    projectLookupCache.set(cacheKey, entry);
    return entry.value;
  }

  function setCachedProjectLookup(cacheKey: string, value: DomainLookupResult): void {
    if (
      projectLookupCache.size >= projectLookupCacheMaxEntries && !projectLookupCache.has(cacheKey)
    ) {
      const oldestKey = projectLookupCache.keys().next().value;
      if (oldestKey !== undefined) projectLookupCache.delete(oldestKey);
    }

    projectLookupCache.set(cacheKey, {
      value,
      expiresAt: Date.now() + projectLookupCacheTtlMs,
    });
  }

  async function resolveProjectLookup(
    lookupKey: string,
    token: string,
    cacheable: boolean,
    timing?: ProxyServerTiming,
  ): Promise<DomainLookupResult | null> {
    const cacheKey = normalizeProjectLookupCacheKey(lookupKey);
    if (cacheable) {
      const cached = getCachedProjectLookup(cacheKey);
      if (cached) {
        if (timing) markProxyServerTimingPhase(timing, "proxy.project_lookup_cache_hit");
        return cached;
      }

      const pending = pendingProjectLookups.get(cacheKey);
      if (pending) {
        if (timing) markProxyServerTimingPhase(timing, "proxy.project_lookup_pending");
        return await pending;
      }
    }

    const lookupPromise = profileProxyServerTimingPhase(
      timing ?? { enabled: false, startedAt: 0, phases: new Map() },
      "proxy.project_lookup",
      () => lookupProjectByDomain(lookupKey, config.apiBaseUrl, token, logger),
    );

    if (!cacheable) return await lookupPromise;

    pendingProjectLookups.set(cacheKey, lookupPromise);
    try {
      const result = await lookupPromise;
      if (result) setCachedProjectLookup(cacheKey, result);
      return result;
    } finally {
      pendingProjectLookups.delete(cacheKey);
    }
  }

  function validateConfig(): string[] {
    const missing: string[] = [];
    if (!config.apiClientId) missing.push("VERYFRONT_PROXY_API_CLIENT_ID");
    if (!config.apiClientSecret) missing.push("VERYFRONT_PROXY_API_CLIENT_SECRET");
    return missing;
  }

  async function resolveReleaseAndProtection(
    req: Request,
    url: URL,
    token: string,
    userToken: string | undefined,
    lookupKey: string,
    envMatcher: (env: NonNullable<DomainLookupResult["environments"]>[number]) => boolean,
    cacheableLookup: boolean,
    timing: ProxyServerTiming | undefined,
    logContext: Record<string, unknown>,
  ): Promise<
    | { projectId?: string; releaseId?: string; environmentId?: string }
    | { error: { status: number; message: string; redirectUrl?: string } }
  > {
    const lookupResult = await resolveProjectLookup(lookupKey, token, cacheableLookup, timing);
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
      isSignedInternalControlPlaneRequest: isSignedInternalControlPlaneRequest(req, url),
    });
    if (protectionError) return { error: protectionError };

    return {
      projectId: lookupResult.id,
      releaseId: matchingEnv?.active_release_id ?? undefined,
      environmentId: matchingEnv?.id,
    };
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
    let tokenSource: ResolvedProxyRequestToken["tokenSource"];
    let tokenFetchError: unknown;

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
          signedInternalControlPlaneRequest: isSignedInternalControlPlaneRequest(req, url),
          tokenFetchErrorMessage: "Token fetch failed",
        },
      ));
      const cacheableProjectLookup = canCacheProjectLookup(tokenSource);

      if (projectSlug && !token) {
        const status = parseStatusFromError(tokenFetchError);
        if (status === 404) {
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

        const lookupResult = await resolveProjectLookup(
          host,
          token,
          cacheableProjectLookup,
          options.timing,
        );
        if (!lookupResult) {
          logger?.info("Custom domain not found", { domain: host });
          return createProxyErrorContext(base, {
            status: 404,
            message: `No project configured for domain: ${host}`,
            token,
          });
        }

        projectSlug = lookupResult.slug;
        projectId = lookupResult.id;

        const normalizedHost = host.toLowerCase().replace(/:\d+$/, "");
        const matchingEnv = lookupResult.environments?.find((env) =>
          env.domains?.some((d) => d.toLowerCase() === normalizedHost)
        );

        releaseId = matchingEnv?.active_release_id ?? undefined;
        environmentId = matchingEnv?.id;

        const protectionError = await checkProtectedProxyAccess({
          req,
          url,
          matchingEnv,
          userToken,
          users: lookupResult.users,
          apiBaseUrl: config.apiBaseUrl,
          logger,
          logContext: { domain: host },
          isSignedInternalControlPlaneRequest: isSignedInternalControlPlaneRequest(req, url),
        });
        if (protectionError) {
          return createProxyErrorContext(base, {
            status: protectionError.status,
            message: protectionError.message,
            token,
            redirectUrl: protectionError.redirectUrl,
          });
        }

        logger?.info("Resolved custom domain to project", {
          domain: host,
          projectSlug,
          projectId,
          releaseId,
          environmentName: matchingEnv?.name,
        });
      } else if (projectSlug && scope === "production" && token && parsedDomain.environment) {
        const targetEnv = parsedDomain.environment.toLowerCase();

        const resolved = await resolveReleaseAndProtection(
          req,
          url,
          token,
          userToken,
          projectSlug,
          (env) => env.name.toLowerCase() === targetEnv,
          cacheableProjectLookup,
          options.timing,
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
        const resolved = await resolveReleaseAndProtection(
          req,
          url,
          token,
          userToken,
          projectSlug,
          (env) => env.name.toLowerCase() === "preview",
          cacheableProjectLookup,
          options.timing,
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
      signedInternalControlPlaneRequest: isSignedInternalControlPlaneRequest(req, url),
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
