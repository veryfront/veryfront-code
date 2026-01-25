/**
 * Proxy Handler - Core Logic
 *
 * Extracted proxy logic that can be used in:
 * - Split mode: Standalone proxy server (proxy/main.ts)
 * - Combined mode: Request interceptor in renderer process
 *
 * Handles:
 * - Domain parsing (subdomain to project slug)
 * - OAuth token management
 * - Local project detection
 * - User auth token extraction from cookies
 */

import { TokenManager, type TokenScope } from "./token-manager.ts";
import { parseProjectDomain, type ParsedDomain } from "../src/server/utils/domain-parser.ts";
import type { TokenCache } from "./cache/types.ts";
import { createFileSystem } from "../src/platform/compat/fs.ts";
import { cwd } from "../src/platform/compat/process.ts";
import { join } from "../src/platform/compat/path/index.ts";
import { injectContext, ProxySpanNames, withSpan } from "./tracing.ts";
import { computeContentSourceId } from "../src/cache/keys.ts";

/**
 * Domain lookup result from API.
 * Uses GET /projects/{domain} which returns full project data.
 */
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

/**
 * Look up project info by custom domain.
 * Uses GET /projects/{domain} to resolve project slug when request comes via custom domain.
 */
async function lookupProjectByDomain(
  domain: string,
  apiBaseUrl: string,
  token: string,
  logger?: ProxyLogger,
): Promise<DomainLookupResult | null> {
  return await withSpan(
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
          // Consume response body to prevent resource leak
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

        const result = await response.json() as DomainLookupResult;
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
  apiToken?: string; // Fallback token when OAuth credentials not available
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
  /** Error if request cannot be processed (e.g., custom domain not found) */
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

/**
 * Determine the OAuth scope based on the parsed domain environment.
 */
function getScope(environment: string | null): TokenScope {
  return environment === "preview" ? "preview" : "production";
}

/**
 * Extract user auth token from cookie header.
 */
function extractUserToken(cookieHeader: string): string | undefined {
  const authTokenMatch = cookieHeader.match(/(?:^|;\s*)authToken=([^;]+)/);
  return authTokenMatch?.[1] ? decodeURIComponent(authTokenMatch[1]) : undefined;
}

/**
 * Create a proxy handler that processes requests and returns context.
 *
 * This is the core proxy logic, usable in both split and combined modes.
 */
export function createProxyHandler(options: ProxyHandlerOptions) {
  const { config, cache, logger } = options;
  const localProjects = config.localProjects ?? {};

  // Dynamic project discovery - check if project exists in common directories
  const fs = createFileSystem();
  async function findLocalProject(slug: string): Promise<string | undefined> {
    // First check the static map
    if (localProjects[slug]) {
      return localProjects[slug];
    }

    // Dynamically check common project directories - parallelized for performance
    const projectDirs = ["projects", "data/projects", "examples"];
    const basePath = cwd();

    // Check all directories in parallel
    const candidatePaths = projectDirs.map((dir) => join(basePath, dir, slug));
    const existsResults = await Promise.all(
      candidatePaths.map(async (projectPath) => {
        try {
          const exists = await fs.exists(projectPath);
          return exists ? projectPath : null;
        } catch {
          return null;
        }
      }),
    );

    // For each existing path, check app/pages/components in parallel
    for (const projectPath of existsResults) {
      if (!projectPath) continue;

      try {
        const [hasApp, hasPages, hasComponents] = await Promise.all([
          fs.exists(join(projectPath, "app")),
          fs.exists(join(projectPath, "pages")),
          fs.exists(join(projectPath, "components")),
        ]);

        if (hasApp || hasPages || hasComponents) {
          // Cache for future requests
          localProjects[slug] = projectPath;
          logger?.debug("Dynamically discovered local project", { slug, projectPath });
          return projectPath;
        }
      } catch {
        // Directory check failed, continue
      }
    }
    return undefined;
  }

  // Create token manager
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

  /**
   * Validate configuration and return missing credentials.
   */
  function validateConfig(): string[] {
    const missing: string[] = [];
    if (!config.clientId) missing.push("API_CLIENT_ID_VERYFRONT_RENDERER_PROXY");
    if (!config.clientSecret) missing.push("API_CLIENT_SECRET_VERYFRONT_RENDERER_PROXY");
    return missing;
  }

  async function processRequest(req: Request): Promise<ProxyContext> {
    const host = req.headers.get("host") || "";
    const parsedDomain = parseProjectDomain(host);
    const scope = getScope(parsedDomain.environment);
    let projectSlug = parsedDomain.slug || undefined;
    let projectId: string | undefined;
    let releaseId: string | undefined;
    const isCustomDomain = !projectSlug && !parsedDomain.isVeryfrontDomain;

    const localPath = projectSlug ? await findLocalProject(projectSlug) : undefined;
    const isLocalProject = !!localPath;

    logger?.debug("Processing request", {
      host,
      projectSlug,
      environment: scope,
      isLocalProject,
      isCustomDomain,
    });

    const makeErrorContext = (
      status: number,
      message: string,
      token?: string,
      redirectUrl?: string,
    ): ProxyContext => ({
      token,
      projectSlug: undefined,
      projectId: undefined,
      environment: scope,
      contentSourceId: "error",
      localPath: undefined,
      host,
      parsedDomain,
      isLocalProject: false,
      error: { status, message, redirectUrl },
    });

    let token: string | undefined;
    // Extract user auth token from cookies (used for preview scope and protected env check)
    const cookieHeader = req.headers.get("cookie") || "";
    const userToken = extractUserToken(cookieHeader);

    if (isLocalProject) {
      logger?.debug("Local project, skipping token fetch", { localPath });
    } else {
      if (scope === "preview" && userToken) {
        token = userToken;
        logger?.debug("Using user auth token for preview");
      }

      if (!token && config.clientId && config.clientSecret) {
        const customDomain = !projectSlug ? host : undefined;
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

      if (isCustomDomain && !projectSlug) {
        // Custom domain: lookup project by domain
        if (!token) {
          logger?.error("Cannot process custom domain without token", undefined, { domain: host });
          return makeErrorContext(502, `Failed to authenticate for domain: ${host}`, token);
        }

        const lookupResult = await lookupProjectByDomain(host, config.apiBaseUrl, token, logger);
        if (lookupResult) {
          projectSlug = lookupResult.slug;
          projectId = lookupResult.id;

          // Find matching environment for this domain and extract active release
          const normalizedHost = host.toLowerCase().replace(/:\d+$/, "");
          const matchingEnv = lookupResult.environments?.find((env) =>
            env.domains?.some((d) => d.toLowerCase() === normalizedHost)
          );
          if (matchingEnv?.active_release_id) {
            releaseId = matchingEnv.active_release_id;
          }

          // Check if environment is protected and user is not authenticated
          if (matchingEnv?.protected && !userToken) {
            const originalUrl = req.url;
            const redirectUrl = `https://veryfront.com/sign-in?from=${encodeURIComponent(originalUrl)}`;
            logger?.info("Protected environment requires authentication", {
              domain: host,
              environmentName: matchingEnv.name,
              redirectUrl,
            });
            return makeErrorContext(302, "Authentication required", token, redirectUrl);
          }

          logger?.info("Resolved custom domain to project", {
            domain: host,
            projectSlug,
            projectId,
            releaseId,
            environmentName: matchingEnv?.name,
          });
        } else {
          logger?.error("Custom domain not found", undefined, { domain: host });
          return makeErrorContext(404, `No project configured for domain: ${host}`, token);
        }
      } else if (projectSlug && scope === "production" && token && parsedDomain.environment) {
        // Veryfront domain in non-preview mode: lookup project by slug to get releaseId
        // This handles production, staging, and other non-preview environments
        const lookupResult = await lookupProjectByDomain(projectSlug, config.apiBaseUrl, token, logger);
        if (lookupResult) {
          projectId = lookupResult.id;

          // Find environment matching the parsed domain's environment (e.g., "staging", "production")
          const matchingEnv = lookupResult.environments?.find((env) =>
            env.name.toLowerCase() === parsedDomain.environment!.toLowerCase()
          );

          if (matchingEnv?.active_release_id) {
            releaseId = matchingEnv.active_release_id;
          }

          // Check if environment is protected and user is not authenticated
          if (matchingEnv?.protected && !userToken) {
            const originalUrl = req.url;
            const redirectUrl = `https://veryfront.com/sign-in?from=${encodeURIComponent(originalUrl)}`;
            logger?.info("Protected environment requires authentication", {
              projectSlug,
              environmentName: matchingEnv.name,
              redirectUrl,
            });
            return makeErrorContext(302, "Authentication required", token, redirectUrl);
          }

          logger?.info("Resolved veryfront domain to project", {
            projectSlug,
            projectId,
            releaseId,
            targetEnvName: parsedDomain.environment,
            environmentName: matchingEnv?.name,
          });
        }
      }
    }

    // Error early if remote production but no releaseId
    if (scope === "production" && projectSlug && !releaseId && !isLocalProject) {
      logger?.error("Missing releaseId in production", undefined, {
        projectSlug,
        projectId,
        host,
        environment: scope,
      });
      return makeErrorContext(502, `Missing releaseId for production project: ${projectSlug}`, token);
    }

    // Compute contentSourceId using the single source of truth
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

  /**
   * Get token for API proxy requests.
   */
  async function getTokenForApi(req: Request): Promise<string | undefined> {
    const host = req.headers.get("host") || "";
    const parsedDomain = parseProjectDomain(host);
    const scope = getScope(parsedDomain.environment);
    const projectSlug = parsedDomain.slug || undefined;

    // Try user token first for preview
    if (scope === "preview") {
      const cookieHeader = req.headers.get("cookie") || "";
      const userToken = extractUserToken(cookieHeader);
      if (userToken) return userToken;
    }

    // Fall back to OAuth (requires projectSlug or customDomain for project-scoped tokens)
    if (config.clientId && config.clientSecret) {
      const customDomain = !projectSlug ? host : undefined;
      if (projectSlug || customDomain) {
        try {
          return await tokenManager.getToken(scope, projectSlug, customDomain);
        } catch (error) {
          logger?.error("Token fetch failed for API", error as Error, { projectSlug, customDomain });
        }
      }
    }

    // Fall back to static API token
    if (config.apiToken) {
      return config.apiToken;
    }

    return undefined;
  }

  /**
   * Get token manager stats for monitoring.
   */
  async function getStats() {
    return await tokenManager.getStats();
  }

  /**
   * Close the token manager and clean up resources.
   */
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

/**
 * Inject proxy context into request headers for the renderer.
 * Used by both split mode (proxy/main.ts) and combined mode (scripts/server.ts).
 */
export function injectContextHeaders(req: Request, ctx: ProxyContext): Request {
  const headers = new Headers(req.headers);

  if (ctx.token) headers.set("x-token", ctx.token);
  headers.set("x-project-slug", ctx.projectSlug || "");
  headers.set("x-environment", ctx.environment);
  headers.set("x-content-source-id", ctx.contentSourceId);
  headers.set("x-forwarded-host", ctx.host);
  if (ctx.localPath) headers.set("x-project-path", ctx.localPath);

  // Forward project/branch context for logging
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
