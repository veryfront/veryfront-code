import { TokenManager, type TokenScope } from "./token-manager.ts";
import { type ParsedDomain, parseProjectDomain } from "#veryfront/server/utils/domain-parser.ts";
import type { TokenCache } from "./cache/types.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { injectContext, ProxySpanNames, withSpan } from "./tracing.ts";
import { computeContentSourceId } from "#veryfront/cache/keys.ts";

interface DomainLookupResult {
  id: string;
  slug: string;
  name: string;
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
  clientId: string;
  clientSecret: string;
  previewClientId: string;
  previewClientSecret: string;
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
  environment: "preview" | "production";
  contentSourceId: string;
  localPath?: string;
  host: string;
  parsedDomain: ParsedDomain;
  isLocalProject: boolean;
  error?: { status: number; message: string; redirectUrl?: string };
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

function getScope(environment: string | null): TokenScope {
  return environment === "preview" ? "preview" : "production";
}

function extractUserToken(cookieHeader: string): string | undefined {
  const match = cookieHeader.match(/(?:^|;\s*)authToken=([^;]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

export function createProxyHandler(options: ProxyHandlerOptions) {
  const { config, cache, logger } = options;
  const localProjects = config.localProjects ?? {};

  const fs = createFileSystem();

  async function findLocalProject(slug: string): Promise<string | undefined> {
    const mapped = localProjects[slug];
    if (mapped) return mapped;

    const projectDirs = ["projects", "data/projects", "examples"];
    const basePath = cwd();
    const candidatePaths = projectDirs.map((dir) => join(basePath, dir, slug));

    const existingPaths = await Promise.all(
      candidatePaths.map(async (projectPath) => {
        try {
          return (await fs.exists(projectPath)) ? projectPath : null;
        } catch {
          return null;
        }
      }),
    );

    for (const projectPath of existingPaths) {
      if (!projectPath) continue;

      try {
        const [hasApp, hasPages, hasComponents] = await Promise.all([
          fs.exists(join(projectPath, "app")),
          fs.exists(join(projectPath, "pages")),
          fs.exists(join(projectPath, "components")),
        ]);

        if (!hasApp && !hasPages && !hasComponents) continue;

        localProjects[slug] = projectPath;
        logger?.debug("Dynamically discovered local project", { slug, projectPath });
        return projectPath;
      } catch {
        // continue
      }
    }

    return undefined;
  }

  const tokenManager = new TokenManager(
    {
      apiBaseUrl: config.apiBaseUrl,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      previewClientId: config.previewClientId,
      previewClientSecret: config.previewClientSecret,
    },
    { cache },
  );

  function validateConfig(): string[] {
    const missing: string[] = [];
    if (!config.clientId) missing.push("API_CLIENT_ID_VERYFRONT_RENDERER_PROXY");
    if (!config.clientSecret) missing.push("API_CLIENT_SECRET_VERYFRONT_RENDERER_PROXY");
    return missing;
  }

  function makeErrorContext(
    base: {
      scope: TokenScope;
      host: string;
      parsedDomain: ParsedDomain;
    },
    status: number,
    message: string,
    token?: string,
    redirectUrl?: string,
  ): ProxyContext {
    return {
      token,
      projectSlug: undefined,
      projectId: undefined,
      environment: base.scope,
      contentSourceId: "error",
      localPath: undefined,
      host: base.host,
      parsedDomain: base.parsedDomain,
      isLocalProject: false,
      error: { status, message, redirectUrl },
    };
  }

  function makeAuthRedirectUrl(req: Request): string {
    return `https://veryfront.com/sign-in?from=${encodeURIComponent(req.url)}`;
  }

  async function resolveReleaseAndProtection(
    req: Request,
    token: string,
    userToken: string | undefined,
    lookupKey: string,
    envMatcher: (env: NonNullable<DomainLookupResult["environments"]>[number]) => boolean,
    logContext: Record<string, unknown>,
  ): Promise<
    | { projectId?: string; releaseId?: string }
    | { error: { status: number; message: string; redirectUrl?: string } }
  > {
    const lookupResult = await lookupProjectByDomain(lookupKey, config.apiBaseUrl, token, logger);
    if (!lookupResult) return { projectId: undefined, releaseId: undefined };

    const matchingEnv = lookupResult.environments?.find(envMatcher);

    if (matchingEnv?.protected && !userToken) {
      const redirectUrl = makeAuthRedirectUrl(req);
      logger?.info("Protected environment requires authentication", {
        ...logContext,
        environmentName: matchingEnv.name,
        redirectUrl,
      });
      return { error: { status: 302, message: "Authentication required", redirectUrl } };
    }

    return {
      projectId: lookupResult.id,
      releaseId: matchingEnv?.active_release_id ?? undefined,
    };
  }

  async function processRequest(req: Request): Promise<ProxyContext> {
    const host = req.headers.get("host") ?? "";
    const parsedDomain = parseProjectDomain(host);
    const scope = getScope(parsedDomain.environment);

    let projectSlug = parsedDomain.slug ?? undefined;
    let projectId: string | undefined;
    let releaseId: string | undefined;

    const isCustomDomain = !projectSlug && !parsedDomain.isVeryfrontDomain;

    if (!projectSlug && parsedDomain.isVeryfrontDomain && !isCustomDomain) {
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

    const localPath = projectSlug ? await findLocalProject(projectSlug) : undefined;
    const isLocalProject = !!localPath;

    logger?.debug("Processing request", {
      host,
      projectSlug,
      environment: scope,
      isLocalProject,
      isCustomDomain,
    });

    const cookieHeader = req.headers.get("cookie") ?? "";
    const userToken = extractUserToken(cookieHeader);

    let token: string | undefined;

    if (isLocalProject) {
      logger?.debug("Local project, skipping token fetch", { localPath });
    } else {
      if (scope === "preview" && userToken) {
        token = userToken;
        logger?.debug("Using user auth token for preview");
      }

      if (!token && config.clientId && config.clientSecret) {
        const customDomain = projectSlug ? undefined : host;
        if (projectSlug || customDomain) {
          try {
            token = await tokenManager.getToken(scope, projectSlug, customDomain);
          } catch (error) {
            logger?.error("Token fetch failed", error as Error, { projectSlug, customDomain });
          }
        }
      }

      if (!token && config.apiToken) {
        token = config.apiToken;
        logger?.debug("Using static API token fallback");
      }

      const base = { scope, host, parsedDomain };

      if (isCustomDomain && !projectSlug) {
        if (!token) {
          logger?.error("Cannot process custom domain without token", undefined, { domain: host });
          return makeErrorContext(base, 502, `Failed to authenticate for domain: ${host}`, token);
        }

        const lookupResult = await lookupProjectByDomain(host, config.apiBaseUrl, token, logger);
        if (!lookupResult) {
          logger?.error("Custom domain not found", undefined, { domain: host });
          return makeErrorContext(base, 404, `No project configured for domain: ${host}`, token);
        }

        projectSlug = lookupResult.slug;
        projectId = lookupResult.id;

        const normalizedHost = host.toLowerCase().replace(/:\d+$/, "");
        const matchingEnv = lookupResult.environments?.find((env) =>
          env.domains?.some((d) => d.toLowerCase() === normalizedHost)
        );

        releaseId = matchingEnv?.active_release_id ?? undefined;

        if (matchingEnv?.protected && !userToken) {
          const redirectUrl = makeAuthRedirectUrl(req);
          logger?.info("Protected environment requires authentication", {
            domain: host,
            environmentName: matchingEnv.name,
            redirectUrl,
          });
          return makeErrorContext(base, 302, "Authentication required", token, redirectUrl);
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
          token,
          userToken,
          projectSlug,
          (env) => env.name.toLowerCase() === targetEnv,
          { projectSlug },
        );

        if ("error" in resolved) {
          return makeErrorContext(
            base,
            resolved.error.status,
            resolved.error.message,
            token,
            resolved.error.redirectUrl,
          );
        }

        projectId = resolved.projectId;
        releaseId = resolved.releaseId;

        logger?.info("Resolved veryfront domain to project", {
          projectSlug,
          projectId,
          releaseId,
          targetEnvName: parsedDomain.environment,
        });
      } else if (projectSlug && scope === "preview" && token) {
        // For preview mode, we need projectId to fetch project metadata (e.g., layout config)
        // but we don't need releaseId since preview uses branch-based content
        const lookupResult = await lookupProjectByDomain(
          projectSlug,
          config.apiBaseUrl,
          token,
          logger,
        );

        if (lookupResult) {
          projectId = lookupResult.id;

          logger?.info("Resolved preview project", {
            projectSlug,
            projectId,
          });
        }
      }
    }

    if (scope === "production" && projectSlug && !releaseId && !isLocalProject) {
      logger?.error("Missing releaseId in production", undefined, {
        projectSlug,
        projectId,
        host,
        environment: scope,
      });
      return makeErrorContext(
        { scope, host, parsedDomain },
        502,
        `Missing releaseId for production project: ${projectSlug}`,
        token,
      );
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
      contentSourceId,
      environment: scope,
      localPath,
      host,
      parsedDomain,
      isLocalProject,
    };
  }

  async function getTokenForApi(req: Request): Promise<string | undefined> {
    const host = req.headers.get("host") ?? "";
    const parsedDomain = parseProjectDomain(host);
    const scope = getScope(parsedDomain.environment);
    const projectSlug = parsedDomain.slug ?? undefined;

    if (scope === "preview") {
      const cookieHeader = req.headers.get("cookie") ?? "";
      const userToken = extractUserToken(cookieHeader);
      if (userToken) return userToken;
    }

    if (config.clientId && config.clientSecret) {
      const customDomain = projectSlug ? undefined : host;
      if (projectSlug || customDomain) {
        try {
          return await tokenManager.getToken(scope, projectSlug, customDomain);
        } catch (error) {
          logger?.error("Token fetch failed for API", error as Error, {
            projectSlug,
            customDomain,
          });
        }
      }
    }

    return config.apiToken;
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

  if (ctx.token) headers.set("x-token", ctx.token);
  headers.set("x-project-slug", ctx.projectSlug ?? "");
  headers.set("x-environment", ctx.environment);
  headers.set("x-content-source-id", ctx.contentSourceId);
  headers.set("x-forwarded-host", ctx.host);
  if (ctx.localPath) headers.set("x-project-path", ctx.localPath);

  if (ctx.projectId) headers.set("x-project-id", ctx.projectId);
  if (ctx.releaseId) headers.set("x-release-id", ctx.releaseId);
  if (ctx.branchId) headers.set("x-branch-id", ctx.branchId);
  if (ctx.branchName) headers.set("x-branch-name", ctx.branchName);

  return new Request(req.url, {
    method: req.method,
    headers,
    body: req.body,
    redirect: "manual",
  });
}
