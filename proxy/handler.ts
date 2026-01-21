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
  environment: "preview" | "production";
  localPath?: string;
  host: string;
  parsedDomain: ParsedDomain;
  isLocalProject: boolean;
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

    // Dynamically check common project directories
    const projectDirs = ["projects", "data/projects", "examples"];
    const basePath = cwd();
    for (const dir of projectDirs) {
      const projectPath = join(basePath, dir, slug);
      try {
        const exists = await fs.exists(projectPath);
        if (exists) {
          // Verify it has app/ or pages/ or components/
          const hasApp = await fs.exists(join(projectPath, "app"));
          const hasPages = await fs.exists(join(projectPath, "pages"));
          const hasComponents = await fs.exists(join(projectPath, "components"));
          if (hasApp || hasPages || hasComponents) {
            // Cache for future requests
            localProjects[slug] = projectPath;
            logger?.debug("Dynamically discovered local project", { slug, projectPath });
            return projectPath;
          }
        }
      } catch {
        // Directory doesn't exist, continue
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

  /**
   * Process a request and return the proxy context.
   * This is the main entry point for proxy logic.
   */
  async function processRequest(req: Request): Promise<ProxyContext> {
    const host = req.headers.get("host") || "";
    const parsedDomain = parseProjectDomain(host);
    const scope = getScope(parsedDomain.environment);
    const projectSlug = parsedDomain.slug || undefined;

    // Check if this is a local project (with dynamic discovery)
    const localPath = projectSlug ? await findLocalProject(projectSlug) : undefined;
    const isLocalProject = !!localPath;

    logger?.debug("Processing request", {
      host,
      projectSlug,
      environment: scope,
      isLocalProject,
    });

    let token: string | undefined;

    // For local projects, skip token fetching entirely
    if (!isLocalProject) {
      // For preview requests, try to use user's auth token from cookie first
      if (scope === "preview") {
        const cookieHeader = req.headers.get("cookie") || "";
        token = extractUserToken(cookieHeader);
        if (token) {
          logger?.debug("Using user auth token for preview");
        }
      }

      // Fall back to OAuth client credentials if no user token
      // Use projectSlug if available, otherwise use custom domain for lookup
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

      // Fall back to static API token if OAuth token not available
      if (!token && config.apiToken) {
        token = config.apiToken;
        logger?.debug("Using static API token fallback");
      }
    } else {
      logger?.debug("Local project, skipping token fetch", { localPath });
    }

    return {
      token,
      projectSlug,
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
    return tokenManager.getStats();
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
  headers.set("x-forwarded-host", ctx.host);
  if (ctx.localPath) headers.set("x-project-path", ctx.localPath);

  return new Request(req.url, {
    method: req.method,
    headers,
    body: req.body,
    redirect: "manual",
  });
}
