/**
 * Universal Veryfront HTTP handler - Modular Architecture
 *
 * Runtime-agnostic HTTP handler using handler-based architecture
 */

import { serverLogger as logger } from "@veryfront/utils";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { metrics } from "@veryfront/observability/simple-metrics/index.ts";

// Import handler system (from new location)
import type { HandlerContext } from "../handlers/types.ts";
import { parseProjectDomain } from "../utils/domain-parser.ts";
import { getEnvironmentType, lookupProjectByDomain } from "../utils/domain-lookup.ts";
import { RouteRegistry } from "@veryfront/routing/registry/index.ts";
import { SecurityConfigLoader } from "@veryfront/security/http/config.ts";
import { getConfig } from "@veryfront/config/loader.ts";
import type { VeryfrontConfig } from "@veryfront/config";

// Import handlers (from new location)
import { AuthHandler } from "@veryfront/security/http/auth.ts";
import { CorsHandler } from "../handlers/response/cors.ts";
import { HealthHandler } from "../handlers/monitoring/health.ts";
import { MetricsHandler } from "../handlers/monitoring/metrics.ts";
import { ClientLogHandler } from "../handlers/monitoring/client-log.ts";
import { DevEndpointsHandler } from "../handlers/dev/endpoints.ts";
import { DevFileHandler } from "../handlers/dev/files/index.ts";
import { StudioEndpointsHandler } from "../handlers/studio/endpoints.ts";
import { StaticHandler } from "../handlers/request/static.ts";
import { SnippetHandler } from "../handlers/request/snippet-handler.ts";
import { LibModulesHandler } from "../handlers/request/lib-modules-handler.ts";
import { RSCHandler } from "../handlers/request/rsc/index.ts";
import { ModuleHandler } from "../handlers/request/module/index.ts";
import { ApiHandlerWrapper } from "../handlers/request/api/index.ts";
import { SSRHandler } from "../handlers/request/ssr/index.ts";
import { NotFoundHandler } from "../handlers/response/not-found.ts";

export interface UniversalHandlerOptions {
  projectDir: string;
  /** When true, expose additional debug logging. */
  debug?: boolean;
  /** Renderer mode: 'development' or 'production'. Defaults to 'production'. */
  mode?: "development" | "production";
  /** Module server URL for ESM imports (e.g., 'http://localhost:8765') */
  moduleServerUrl?: string;
  /** Pre-loaded config (avoids re-loading via FSAdapter) */
  config?: VeryfrontConfig;
}

/**
 * Create a universal, runtime-agnostic HTTP handler using the provided adapter.
 *
 * This implementation uses a modular handler-based architecture with:
 * - RouteRegistry for managing handlers
 * - Priority-based handler execution
 * - Clean separation of concerns
 * - Easy extensibility
 */
export function createVeryfrontHandler(
  projectDir: string,
  adapter: RuntimeAdapter,
  opts: UniversalHandlerOptions = { projectDir },
): ((req: Request) => Promise<Response>) & { ready?: Promise<void> } {
  const logDebug = (message: string, extra?: Record<string, unknown>) => {
    try {
      const shouldDebug = opts.debug || adapter.env.get("VERYFRONT_DEBUG");
      if (shouldDebug) {
        if (extra && typeof extra === "object" && !Array.isArray(extra)) {
          logger.debug(message, extra);
        } else {
          logger.debug(message);
        }
      }
    } catch (err) {
      // Silently ignore logging errors in non-deno hosts
      logger.error("Debug logging failed:", err);
    }
  };

  logDebug("[universal] handler initialized", { projectDir });

  // Initialize security config loader
  const securityLoader = new SecurityConfigLoader(projectDir, adapter);

  // Use pre-loaded config if provided, otherwise load eagerly
  // In proxy mode, config must be pre-loaded since we can't read files at startup
  let config: VeryfrontConfig | undefined = opts.config;
  const configPromise = opts.config
    ? Promise.resolve(opts.config)
    : getConfig(projectDir, adapter).then((c) => {
      config = c;
      return c;
    }).catch((err) => {
      logger.warn("[universal] Failed to load config, using defaults", {
        error: err instanceof Error ? err.message : String(err),
      });
      return undefined;
    });

  // Initialize route registry
  const registry = new RouteRegistry({
    debug: opts.debug,
    enableMetrics: true,
  });

  // Create API handler with eager initialization
  const apiHandler = new ApiHandlerWrapper(projectDir, adapter);

  // Register handlers in priority order
  registry.registerAll([
    new AuthHandler(), // Priority: 0 (CRITICAL)
    new CorsHandler(), // Priority: 50
    new HealthHandler(), // Priority: 100 (HIGH)
    new MetricsHandler(), // Priority: 100 (HIGH)
    new ClientLogHandler(), // Priority: 200 (HIGH, dev only)
    new DevEndpointsHandler(), // Priority: 300 (HIGH, dev only)
    new StudioEndpointsHandler(), // Priority: 300 (HIGH, Studio iframe scripts)
    new DevFileHandler(), // Priority: 400 (dev only)
    new SnippetHandler(), // Priority: 450 (before static, handles @/ component previews)
    new StaticHandler(), // Priority: 500 (MEDIUM_STATIC)
    new LibModulesHandler(), // Priority: 550 (MEDIUM_LIB_MODULES, self-hosted veryfront/ai/*)
    new RSCHandler(), // Priority: 600 (MEDIUM, runs before static to expose RSC endpoints)
    new ModuleHandler(), // Priority: 600 (MEDIUM)
    apiHandler, // Priority: 700 (MEDIUM)
    new SSRHandler(), // Priority: 1000 (LOW)
    new NotFoundHandler(), // Priority: 10000 (FALLBACK)
  ]);

  // Check if running in proxy mode (multi-project per-request handling)
  const isProxyMode = opts.config?.fs?.veryfront?.proxyMode === true;

  // Pre-initialize API handler to discover routes before any requests
  // In proxy mode, skip eager initialization since there's no request context at startup
  const readyPromise = isProxyMode ? Promise.resolve() : apiHandler.initialize().catch((err) => {
    logger.error("[universal] API handler initialization failed", {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    // Re-throw to prevent server from starting with broken API routing
    throw err;
  });

  if (isProxyMode) {
    logger.info("[universal] Running in proxy mode - lazy initialization enabled");
  }

  const handler = async (req: Request): Promise<Response> => {
    // Ensure API handler is ready before processing requests
    await readyPromise;

    // Ensure security config is loaded (skip in proxy mode - loaded per-request)
    if (!isProxyMode) {
      await securityLoader.ensureLoaded();
    }

    // Ensure config is loaded
    await configPromise;

    const _url = new URL(req.url);

    // Parse domain from host header
    const host = req.headers.get("host") || _url.host;
    const parsedDomain = parseProjectDomain(host);

    // Check for proxy-provided headers (from Deno proxy)
    const proxyToken = req.headers.get("x-token") || undefined;
    const proxySlug = req.headers.get("x-project-slug") || undefined;
    let proxyEnv = req.headers.get("x-environment") as "preview" | "production" | undefined;
    const forwardedHost = req.headers.get("x-forwarded-host") || undefined;

    // Get project slug: proxy header > URL parsing > config
    const configuredSlug = config?.fs?.veryfront?.projectSlug;
    let projectSlug = proxySlug || parsedDomain.slug || configuredSlug;
    let projectId: string | undefined;

    // DEBUG: Log config state
    logger.info("[universal] DEBUG config state", {
      hasConfig: !!config,
      hasFsConfig: !!config?.fs,
      hasVeryfrontConfig: !!config?.fs?.veryfront,
      configuredSlug,
      proxySlug,
      parsedDomainSlug: parsedDomain.slug,
      finalProjectSlug: projectSlug,
      isVeryfrontDomain: parsedDomain.isVeryfrontDomain,
    });

    // For custom domains without a slug, look up the project via API
    // This enables JIT rendering for production sites with custom domains
    if (!projectSlug && !parsedDomain.isVeryfrontDomain && config?.fs?.veryfront) {
      // Use proxy token (from x-token header) or fall back to config token
      const effectiveToken = proxyToken || config.fs.veryfront.apiToken || "";
      // Support both baseUrl (FSAdapterConfig) and apiBaseUrl (VeryfrontConfig) for compatibility
      const baseUrl = (config.fs.veryfront as { baseUrl?: string; apiBaseUrl?: string }).baseUrl ||
        config.fs.veryfront.apiBaseUrl ||
        "https://api.veryfront.com/api";
      const apiConfig = {
        apiBaseUrl: baseUrl,
        apiToken: effectiveToken,
      };

      // Use forwarded host (original domain) for lookup, fall back to host header
      const lookupHost = forwardedHost || host;

      if (apiConfig.apiToken) {
        logger.info("[universal] Custom domain detected, looking up project", {
          host: lookupHost,
          originalHost: host,
          forwardedHost,
          hasProxyToken: !!proxyToken,
          hasConfigToken: !!config.fs.veryfront.apiToken,
        });
        const lookupResult = await lookupProjectByDomain(lookupHost, apiConfig);

        if (lookupResult) {
          projectSlug = lookupResult.projectSlug;
          projectId = lookupResult.projectId;
          proxyEnv = getEnvironmentType(lookupResult);
          logger.info("[universal] Domain lookup successful", {
            domain: host,
            projectSlug: lookupResult.projectSlug,
            projectId: lookupResult.projectId,
            environment: proxyEnv,
            releaseId: lookupResult.releaseId,
          });
        } else {
          logger.warn("[universal] No project found for domain", { host: lookupHost });
        }
      } else {
        logger.warn("[universal] Cannot look up custom domain - no API token available", {
          host: lookupHost,
          hasProxyToken: !!proxyToken,
          hasConfigToken: !!config?.fs?.veryfront?.apiToken,
        });
      }
    }

    // Log if slug from URL differs from config (for debugging)
    if (parsedDomain.slug && configuredSlug && parsedDomain.slug !== configuredSlug) {
      logDebug("[universal] Project slug mismatch", {
        fromUrl: parsedDomain.slug,
        fromConfig: configuredSlug,
        usingSlug: projectSlug,
      });
    }

    // Log proxy mode for debugging
    if (proxyToken) {
      logDebug("[universal] Using proxy-provided token", {
        projectSlug,
        environment: proxyEnv,
      });
    }

    // Create handler context
    const ctx: HandlerContext = {
      projectDir,
      adapter,
      mode: opts.mode ?? "production",
      moduleServerUrl: opts.moduleServerUrl,
      securityConfig: securityLoader.getSecurityConfig(),
      cspUserHeader: securityLoader.getCspUserHeader(),
      debug: opts.debug,
      config,
      parsedDomain,
      projectSlug,
      projectId,
      proxyToken,
      proxyEnvironment: proxyEnv,
    };

    // Track metrics
    await metrics.incRequest();

    // Execute handler chain
    const response = await registry.execute(req, ctx);

    // If no handler produced a response, this should not happen
    // as NotFoundHandler is the fallback
    if (!response) {
      logDebug("[universal] No handler produced response (unexpected)", {
        path: new URL(req.url).pathname,
      });
      return new Response("Internal Server Error", { status: 500 });
    }

    return response;
  };

  // Attach ready promise for external initialization tracking
  handler.ready = readyPromise;

  return handler;
}

// Re-export types and utilities for backward compatibility
export type { HandlerContext } from "../handlers/types.ts";
export { RouteRegistry } from "@veryfront/routing/registry/index.ts";
export { BaseHandler } from "../handlers/response/base.ts";
