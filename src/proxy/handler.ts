import { TokenManager, type TokenScope } from "./token-manager.ts";
import { type ParsedDomain, parseProjectDomain } from "#veryfront/server/utils/domain-parser.ts";
import type { TokenCache } from "./cache/types.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { cwd, getEnv } from "#veryfront/platform/compat/process.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { injectContext, ProxySpanNames, withSpan } from "./tracing.ts";
import { computeContentSourceId } from "#veryfront/cache/keys.ts";
import { jwtVerify } from "jose";

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

function getScope(environment: string | null): TokenScope {
  return environment === "preview" ? "preview" : "production";
}

function extractUserToken(cookieHeader: string): string | undefined {
  const match = cookieHeader.match(/(?:^|;\s*)authToken=([^;]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

function decodePayloadUnsafe(token: string): string | undefined {
  try {
    const payload = token.split(".")[1];
    if (!payload) return undefined;
    let base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const remainder = base64.length % 4;
    if (remainder === 2) base64 += "==";
    else if (remainder === 3) base64 += "=";
    const decoded = JSON.parse(atob(base64));
    return decoded?.userId;
  } catch (_) {
    /* expected: malformed JWT token */
    return undefined;
  }
}

async function extractUserIdFromToken(
  token: string,
  isLocal: boolean,
  log?: ProxyLogger,
): Promise<string | undefined> {
  const jwtSecret = getEnv("JWT_SECRET");

  // In local dev mode without a configured secret, fall back to unverified decode
  if (!jwtSecret && isLocal) {
    return decodePayloadUnsafe(token);
  }

  if (!jwtSecret) {
    log?.warn("JWT_SECRET not configured — cannot verify user token");
    return undefined;
  }

  try {
    const secret = new TextEncoder().encode(jwtSecret);
    const { payload } = await jwtVerify(token, secret);
    return (payload as { userId?: string }).userId;
  } catch (error) {
    log?.debug("JWT verification failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

function isProjectMember(
  users: Array<{ id: string }> | undefined,
  userId: string | undefined,
): boolean {
  if (!users || !userId) return false;
  return users.some((u) => u.id === userId);
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
        } catch (_) {
          /* expected: filesystem check may fail */
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
      } catch (_) {
        // expected: filesystem check may fail
      }
    }

    return undefined;
  }

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

  function validateConfig(): string[] {
    const missing: string[] = [];
    if (!config.apiClientId) missing.push("VERYFRONT_PROXY_API_CLIENT_ID");
    if (!config.apiClientSecret) missing.push("VERYFRONT_PROXY_API_CLIENT_SECRET");
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
    slug?: string,
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
      error: { status, message, redirectUrl, slug },
    };
  }

  function makeAuthRedirectUrl(req: Request): string {
    const url = new URL(req.url);
    // Collapse leading slashes to prevent protocol-relative open redirects (e.g. "//evil.com/path")
    const safePath = url.pathname.replace(/^\/\/+/, "/");
    const returnPath = safePath + url.search;
    return `https://veryfront.com/sign-in?from=${encodeURIComponent(returnPath)}`;
  }

  async function checkProtectedAccess(
    req: Request,
    matchingEnv: NonNullable<DomainLookupResult["environments"]>[number] | undefined,
    userToken: string | undefined,
    users: DomainLookupResult["users"],
    logContext: Record<string, unknown>,
    isLocal: boolean,
  ): Promise<{ status: number; message: string; redirectUrl?: string } | null> {
    if (!matchingEnv?.protected) return null;

    if (!userToken) {
      const redirectUrl = makeAuthRedirectUrl(req);
      logger?.info("Protected environment requires authentication", {
        ...logContext,
        environmentName: matchingEnv.name,
        redirectUrl,
      });
      return { status: 302, message: "Authentication required", redirectUrl };
    }

    const userId = await extractUserIdFromToken(userToken, isLocal, logger);
    if (!userId) {
      const redirectUrl = makeAuthRedirectUrl(req);
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

  async function resolveReleaseAndProtection(
    req: Request,
    token: string,
    userToken: string | undefined,
    lookupKey: string,
    envMatcher: (env: NonNullable<DomainLookupResult["environments"]>[number]) => boolean,
    logContext: Record<string, unknown>,
    isLocal: boolean,
  ): Promise<
    | { projectId?: string; releaseId?: string; environmentId?: string }
    | { error: { status: number; message: string; redirectUrl?: string } }
  > {
    const lookupResult = await lookupProjectByDomain(lookupKey, config.apiBaseUrl, token, logger);
    if (!lookupResult) return { projectId: undefined, releaseId: undefined };

    const matchingEnv = lookupResult.environments?.find(envMatcher);

    const protectionError = await checkProtectedAccess(
      req,
      matchingEnv,
      userToken,
      lookupResult.users,
      logContext,
      isLocal,
    );
    if (protectionError) return { error: protectionError };

    return {
      projectId: lookupResult.id,
      releaseId: matchingEnv?.active_release_id ?? undefined,
      environmentId: matchingEnv?.id,
    };
  }

  async function processRequest(req: Request): Promise<ProxyContext> {
    const rawHost = req.headers.get("host") ?? "";
    const host = rawHost.replace(/:\d+$/, "");
    const parsedDomain = parseProjectDomain(host);
    const scope = getScope(parsedDomain.environment);

    let projectSlug = parsedDomain.slug ?? undefined;
    let projectId: string | undefined;
    let releaseId: string | undefined;
    let environmentId: string | undefined;

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

      if (!token && config.apiClientId && config.apiClientSecret) {
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
        environmentId = matchingEnv?.id;

        const protectionError = await checkProtectedAccess(
          req,
          matchingEnv,
          userToken,
          lookupResult.users,
          { domain: host },
          isLocalProject,
        );
        if (protectionError) {
          return makeErrorContext(
            base,
            protectionError.status,
            protectionError.message,
            token,
            protectionError.redirectUrl,
          );
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
          isLocalProject,
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
          token,
          userToken,
          projectSlug,
          (env) => env.name.toLowerCase() === "preview",
          { projectSlug },
          isLocalProject,
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
      return makeErrorContext(
        { scope, host, parsedDomain },
        404,
        "No active release found",
        token,
        undefined,
        "release-not-found",
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
      environmentId,
      contentSourceId,
      environment: scope,
      localPath,
      host,
      parsedDomain,
      isLocalProject,
    };
  }

  async function getTokenForApi(req: Request): Promise<string | undefined> {
    const rawHost = req.headers.get("host") ?? "";
    const host = rawHost.replace(/:\d+$/, "");
    const parsedDomain = parseProjectDomain(host);
    const scope = getScope(parsedDomain.environment);
    const projectSlug = parsedDomain.slug ?? undefined;

    if (scope === "preview") {
      const cookieHeader = req.headers.get("cookie") ?? "";
      const userToken = extractUserToken(cookieHeader);
      if (userToken) return userToken;
    }

    if (config.apiClientId && config.apiClientSecret) {
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
