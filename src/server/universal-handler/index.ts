/**
 * Universal Veryfront HTTP handler - Modular Architecture
 *
 * Runtime-agnostic HTTP handler using handler-based architecture
 */

import { serverLogger as logger } from "@veryfront/utils";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { metrics } from "@veryfront/observability/simple-metrics/index.ts";
import {
  endServerSpan,
  extractContext,
  setSpanAttributes,
  startServerSpan,
  withContext,
} from "@veryfront/observability/tracing/otlp-setup.ts";

// Import handler system (from new location)
import type { HandlerContext } from "../handlers/types.ts";
import { parseProjectDomain } from "../utils/domain-parser.ts";
import { getEnvironmentType, lookupProjectByDomain } from "../utils/domain-lookup.ts";
import { getErrorMessage } from "@veryfront/errors/veryfront-error.ts";

/** Check if host is a private/internal IP address */
function isInternalHost(host: string): boolean {
  // Extract hostname without port
  const hostname = host.split(":")[0] ?? "";

  // Check for localhost
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
    return true;
  }

  // Check for private IPv4 ranges (10.x.x.x, 172.16-31.x.x, 192.168.x.x)
  const ipv4Match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4Match) {
    const a = Number(ipv4Match[1]);
    const b = Number(ipv4Match[2]);
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
  }

  return false;
}

/** Monitoring paths that should skip domain lookup */
const MONITORING_PATHS = new Set(["/healthz", "/readyz", "/_health", "/metrics"]);

/** Check if request path is a monitoring endpoint that should skip domain lookup */
function isMonitoringPath(pathname: string): boolean {
  return MONITORING_PATHS.has(pathname);
}

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
import { MemoryDebugHandler } from "../handlers/monitoring/memory.ts";
import { DevEndpointsHandler } from "../handlers/dev/endpoints.ts";
import { DevFileHandler } from "../handlers/dev/files/index.ts";
import { DebugContextHandler } from "../handlers/dev/debug-context.ts";
import { StudioEndpointsHandler } from "../handlers/studio/endpoints.ts";
import { StaticHandler } from "../handlers/request/static.ts";
import { SnippetHandler } from "../handlers/request/snippet-handler.ts";
import { LibModulesHandler } from "../handlers/request/lib-modules-handler.ts";
import { RSCHandler } from "../handlers/request/rsc/index.ts";
import { ModuleHandler } from "../handlers/request/module/index.ts";
import { ApiHandlerWrapper } from "../handlers/request/api/index.ts";
import { SSRHandler } from "../handlers/request/ssr/index.ts";
import { NotFoundHandler } from "../handlers/response/not-found.ts";
import { HMRHandler } from "../handlers/preview/hmr-handler.ts";

/** Valid proxy environment values */
const VALID_PROXY_ENVIRONMENTS = ["preview", "production"] as const;
type ProxyEnvironment = (typeof VALID_PROXY_ENVIRONMENTS)[number];

/** Validate and parse proxy environment header */
export function parseProxyEnvironment(value: string | null): ProxyEnvironment | undefined {
  if (!value) return undefined;
  return VALID_PROXY_ENVIRONMENTS.includes(value as ProxyEnvironment)
    ? (value as ProxyEnvironment)
    : undefined;
}

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
  const isDebugEnabled = opts.debug || adapter.env.get("VERYFRONT_DEBUG");

  const logDebug = (message: string, extra?: Record<string, unknown>): void => {
    if (!isDebugEnabled) return;
    if (extra) {
      logger.debug(message, extra);
    } else {
      logger.debug(message);
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
        error: getErrorMessage(err),
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
    new HMRHandler(), // Priority: 25 (preview mode HMR WebSocket)
    new CorsHandler(), // Priority: 50
    new HealthHandler(), // Priority: 100 (HIGH)
    new MetricsHandler(), // Priority: 100 (HIGH)
    new MemoryDebugHandler(), // Priority: 100 (HIGH, memory profiling endpoints)
    new ClientLogHandler(), // Priority: 200 (HIGH, dev only)
    new DevEndpointsHandler(), // Priority: 300 (HIGH, dev only)
    new DebugContextHandler(), // Priority: 300 (HIGH, dev only - context debugging)
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
      error: getErrorMessage(err),
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

    // Start tracing span for this request
    const parentContext = extractContext(req.headers);
    const spanInfo = startServerSpan(req.method, _url.pathname, parentContext);
    const span = spanInfo?.span;

    // Set initial span attributes
    if (span) {
      setSpanAttributes(span, {
        "http.url": req.url,
        "http.host": req.headers.get("host") || _url.host,
        "http.scheme": _url.protocol.replace(":", ""),
      });
    }

    // Execute request handling within span context
    const executeHandler = async (): Promise<Response> => {
      // Check for proxy-provided headers (from Deno proxy)
      // For WebSocket requests, also check query params since custom headers aren't supported
      const proxyToken = req.headers.get("x-token") || undefined;
      const proxySlug = req.headers.get("x-project-slug") ||
        _url.searchParams.get("x-project-slug") || undefined;
      let proxyEnv = parseProxyEnvironment(
        req.headers.get("x-environment") || _url.searchParams.get("x-environment"),
      );
      const forwardedHost = req.headers.get("x-forwarded-host") || undefined;

      // Parse domain from host header
      // Prefer x-forwarded-host (original domain from proxy) over Host header (internal service URL)
      const host = forwardedHost || req.headers.get("host") || _url.host;
      const parsedDomain = parseProjectDomain(host);

      // Get project slug: proxy header > URL parsing > config
      const configuredSlug = config?.fs?.veryfront?.projectSlug;
      let projectSlug = proxySlug || parsedDomain.slug || configuredSlug;
      let projectId: string | undefined;
      let releaseId: string | undefined;

      // Debug: Log config state for troubleshooting
      logger.debug("[universal] config state", {
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
      // Skip for: internal IPs (health checks), monitoring endpoints, veryfront domains
      const shouldSkipDomainLookup = isInternalHost(host) || isMonitoringPath(_url.pathname);
      if (
        !projectSlug && !parsedDomain.isVeryfrontDomain && config?.fs?.veryfront &&
        !shouldSkipDomainLookup
      ) {
        // Use proxy token (from x-token header) or fall back to config token
        const effectiveToken = proxyToken || config.fs.veryfront.apiToken || "";
        // Support both baseUrl (FSAdapterConfig) and apiBaseUrl (VeryfrontConfig) for compatibility
        const baseUrl =
          (config.fs.veryfront as { baseUrl?: string; apiBaseUrl?: string }).baseUrl ||
          config.fs.veryfront.apiBaseUrl ||
          "https://api.veryfront.com";
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
            projectSlug = lookupResult.project_slug;
            projectId = lookupResult.project_id;
            releaseId = lookupResult.release_id ?? undefined;
            proxyEnv = getEnvironmentType(lookupResult);
            logger.info("[universal] Domain lookup successful", {
              domain: host,
              projectSlug: lookupResult.project_slug,
              projectId: lookupResult.project_id,
              environment: proxyEnv,
              releaseId: lookupResult.release_id,
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

      // For Veryfront production domains, look up the current release ID for cache keying
      // This ensures cache invalidation when new releases are published
      // Use the same domain lookup API that works for custom domains
      if (
        parsedDomain.isVeryfrontDomain &&
        parsedDomain.isDraft === false &&
        projectSlug &&
        !releaseId &&
        config?.fs?.veryfront &&
        !shouldSkipDomainLookup
      ) {
        const effectiveToken = proxyToken || config.fs.veryfront.apiToken || "";
        const baseUrl =
          (config.fs.veryfront as { baseUrl?: string; apiBaseUrl?: string }).baseUrl ||
          config.fs.veryfront.apiBaseUrl ||
          "https://api.veryfront.com";

        if (effectiveToken) {
          // Use the domain lookup API with the Veryfront domain
          const lookupResult = await lookupProjectByDomain(host, {
            apiBaseUrl: baseUrl,
            apiToken: effectiveToken,
          });

          if (lookupResult?.release_id) {
            releaseId = lookupResult.release_id;
            projectId = projectId || lookupResult.project_id;
            proxyEnv = "production";
            logger.info("[universal] Veryfront domain release lookup successful", {
              projectSlug,
              releaseId,
              projectId,
            });
          }
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

      // Add project info to span
      if (span && projectSlug) {
        setSpanAttributes(span, {
          "veryfront.project_slug": projectSlug,
          "veryfront.environment": proxyEnv || "unknown",
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
        releaseId,
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

    // Execute with span context and finalize span
    let response: Response;
    let error: Error | undefined;

    try {
      if (spanInfo?.context) {
        response = await withContext(spanInfo.context, executeHandler);
      } else {
        response = await executeHandler();
      }
    } catch (e) {
      error = e instanceof Error ? e : new Error(String(e));
      response = new Response("Internal Server Error", { status: 500 });
    }

    // End the span with status
    endServerSpan(span, response.status, error);

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
