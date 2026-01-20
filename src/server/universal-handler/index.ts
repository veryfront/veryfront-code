/**
 * Universal Veryfront HTTP handler - Modular Architecture
 *
 * Runtime-agnostic HTTP handler using handler-based architecture
 */

import {
  endRequest,
  isEnabled as isPerfEnabled,
  serverLogger as logger,
  startRequest,
  startTimer,
  timeAsync,
} from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { metrics } from "#veryfront/observability/simple-metrics/index.ts";
import {
  endServerSpan,
  extractContext,
  setSpanAttributes,
  startServerSpan,
  withContext,
  withSpan,
} from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import { getTimeoutFromEnv } from "../../middleware/builtin/timeout.ts";

// Import handler system (from new location)
import type { HandlerContext } from "../handlers/types.ts";
import { parseProjectDomain } from "../utils/domain-parser.ts";
import { getEnvironmentType, lookupProjectByDomain } from "../utils/domain-lookup.ts";
import { getErrorMessage } from "#veryfront/errors/veryfront-error.ts";
import { getAdapter } from "#veryfront/platform/adapters/detect.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";

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

/** Request timeout in milliseconds (configurable via REQUEST_TIMEOUT_MS env var) */
const REQUEST_TIMEOUT_MS = getTimeoutFromEnv();

/** HTTP 504 Gateway Timeout status code */
const HTTP_GATEWAY_TIMEOUT = 504;

/** Sentinel value for timeout detection (avoids string comparison) */
const TIMEOUT_SENTINEL = Symbol("request_timeout");

/** Check if request path is a monitoring endpoint that should skip domain lookup */
function isMonitoringPath(pathname: string): boolean {
  return MONITORING_PATHS.has(pathname);
}

import { RouteRegistry } from "#veryfront/routing/registry/index.ts";
import { SecurityConfigLoader } from "#veryfront/security/http/config.ts";
import { getConfig } from "#veryfront/config/loader.ts";
import type { VeryfrontConfig } from "#veryfront/config";

// Import handlers (from new location)
import { AuthHandler } from "#veryfront/security/http/auth.ts";
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
import { OpenAPIHandler } from "../handlers/request/openapi-handler.ts";
import { OpenAPIDocsHandler } from "../handlers/request/openapi-docs-handler.ts";
import { DevDashboardHandler } from "../handlers/dev/dashboard/index.ts";
import { ProjectsHandler } from "../handlers/dev/projects/index.ts";

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
  /** Map of local project slugs to their filesystem paths (for unified dev server) */
  localProjects?: Record<string, string>;
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
  const securityLoader = new SecurityConfigLoader(projectDir, adapter, opts.config);

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
    new OpenAPIHandler(), // Priority: 300 (HIGH, serves /_openapi.json)
    new OpenAPIDocsHandler(), // Priority: 300 (HIGH, serves /_docs with Scalar UI)
    new DevDashboardHandler(), // Priority: 300 (HIGH, dev only - unified dev dashboard at /_dev)
    new ProjectsHandler(), // Priority: HIGH (multi-project mode landing page with React UI)
    new StudioEndpointsHandler(), // Priority: 300 (HIGH, Studio iframe scripts)
    new DevFileHandler(), // Priority: 400 (dev only)
    new SnippetHandler(), // Priority: 450 (before static, handles @/ component previews)
    new StaticHandler(), // Priority: 500 (MEDIUM_STATIC)
    new LibModulesHandler(), // Priority: 550 (MEDIUM_LIB_MODULES, self-hosted veryfront modules)
    new RSCHandler(), // Priority: 600 (MEDIUM, runs before static to expose RSC endpoints)
    new ModuleHandler(), // Priority: 600 (MEDIUM)
    apiHandler, // Priority: 700 (MEDIUM)
    new SSRHandler(), // Priority: 1000 (LOW)
    new NotFoundHandler(), // Priority: 10000 (FALLBACK)
  ]);

  // Check if running in proxy mode (multi-project per-request handling)
  const isProxyMode = opts.config?.fs?.veryfront?.proxyMode === true;

  // Cache for per-request local adapters (keyed by projectDir)
  const localAdapterCache = new Map<string, RuntimeAdapter>();

  // Standard directories to auto-discover local projects (filesystem-first)
  const standardProjectDirs = ["data/projects", "projects", "examples"];

  // Cache for discovered local project paths (slug → absolute path)
  const localProjectCache = new Map<string, string>();

  /**
   * Check if a project exists locally (filesystem-first).
   * First checks x-project-path header (from proxy), then scans standard directories.
   */
  async function findLocalProjectPath(
    slug: string,
    headerPath?: string,
  ): Promise<string | undefined> {
    // If proxy provided explicit path via header, use it directly
    if (headerPath) {
      localProjectCache.set(slug, headerPath);
      return headerPath;
    }

    // Check cache
    if (localProjectCache.has(slug)) {
      return localProjectCache.get(slug);
    }

    // Auto-discover from standard directories
    for (const dir of standardProjectDirs) {
      const projectPath = `${dir}/${slug}`;
      try {
        const stat = await adapter.fs.stat(projectPath);
        if (stat?.isDirectory) {
          // Verify it looks like a veryfront project (has app/, pages/, or components/)
          const hasApp = await adapter.fs.stat(`${projectPath}/app`).then((s) => s?.isDirectory)
            .catch(() => false);
          const hasPages = await adapter.fs.stat(`${projectPath}/pages`).then((s) => s?.isDirectory)
            .catch(() => false);
          const hasComponents = await adapter.fs.stat(`${projectPath}/components`).then((s) =>
            s?.isDirectory
          ).catch(() => false);
          if (hasApp || hasPages || hasComponents) {
            const absolutePath = projectPath.startsWith("/")
              ? projectPath
              : `${cwd()}/${projectPath}`;
            localProjectCache.set(slug, absolutePath);
            logger.debug("[universal] Discovered local project", { slug, path: absolutePath });
            return absolutePath;
          }
        }
      } catch {
        // Directory doesn't exist, continue
      }
    }

    return undefined;
  }

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
    logger.debug("[universal] Running in proxy mode - lazy initialization enabled");
  }

  const handler = async (req: Request): Promise<Response> => {
    const perfEnabled = isPerfEnabled();
    const perfRequestId = perfEnabled
      ? req.headers.get("x-request-id") ?? crypto.randomUUID()
      : undefined;
    if (perfRequestId) {
      startRequest(perfRequestId);
    }
    const stopTotal = startTimer("total");

    try {
      // Ensure API handler is ready before processing requests
      await readyPromise;

      // Ensure security config is loaded (skip in proxy mode - loaded per-request)
      await timeAsync("security:load", async () => {
        if (!isProxyMode) {
          await securityLoader.ensureLoaded();
        }
      });

      // Ensure config is loaded
      await timeAsync("config:load", async () => {
        await configPromise;
      });

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
        // x-project-path: explicit local filesystem path for this project (from proxy)
        const proxyProjectPath = req.headers.get("x-project-path") || undefined;
        let proxyEnv = parseProxyEnvironment(
          req.headers.get("x-environment") || _url.searchParams.get("x-environment"),
        );
        // Allow ?preview_mode=true to simulate preview environment locally (for E2E testing)
        if (_url.searchParams.get("preview_mode") === "true") {
          proxyEnv = "preview";
        }
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
        let environmentName: string | undefined;

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
            logger.debug("[universal] Custom domain detected, looking up project", {
              host: lookupHost,
              originalHost: host,
              forwardedHost,
              hasProxyToken: !!proxyToken,
              hasConfigToken: !!config.fs.veryfront.apiToken,
            });
            const lookupResult = await withSpan(
              SpanNames.DOMAIN_LOOKUP,
              () => lookupProjectByDomain(lookupHost, apiConfig),
              { "domain.host": lookupHost, "domain.original_host": host },
            );

            if (lookupResult) {
              projectSlug = lookupResult.project_slug;
              projectId = lookupResult.project_id;
              releaseId = lookupResult.release_id ?? undefined;
              environmentName = lookupResult.environment?.name;
              // Only use domain-based environment detection if proxy didn't provide one
              // This respects preview proxy's x-environment header for draft content access
              if (!proxyEnv) {
                proxyEnv = getEnvironmentType(lookupResult);
              }
              logger.debug("[universal] Domain lookup successful", {
                domain: host,
                projectSlug: lookupResult.project_slug,
                projectId: lookupResult.project_id,
                environment: proxyEnv,
                environmentName,
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
            const lookupResult = await withSpan(
              SpanNames.DOMAIN_RELEASE_LOOKUP,
              () =>
                lookupProjectByDomain(host, {
                  apiBaseUrl: baseUrl,
                  apiToken: effectiveToken,
                }),
              { "domain.host": host, "domain.project_slug": projectSlug },
            );

            if (lookupResult?.release_id) {
              releaseId = lookupResult.release_id;
              projectId = projectId || lookupResult.project_id;
              environmentName = environmentName || lookupResult.environment?.name;
              proxyEnv = "production";
              logger.debug("[universal] Veryfront domain release lookup successful", {
                projectSlug,
                releaseId,
                projectId,
                environmentName,
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

        // Filesystem-first: check if this project exists locally
        // 1. Use x-project-path header if provided (explicit from proxy)
        // 2. Otherwise auto-discover from standard directories
        // Local projects are served from filesystem, API is fallback
        let effectiveProjectDir = projectDir;
        let effectiveAdapter = adapter;
        const localProjectPath = projectSlug
          ? await findLocalProjectPath(projectSlug, proxyProjectPath)
          : undefined;
        const isLocalProject = !!localProjectPath;

        // Determine the effective config for this request
        // For local projects, load project-specific config
        // For proxy mode (API) projects, set config to undefined to force loading in createContextFromHandler
        let effectiveConfig: VeryfrontConfig | undefined = config;

        if (isLocalProject && localProjectPath) {
          effectiveProjectDir = localProjectPath;
          logger.debug("[universal] Using local project (filesystem-first)", {
            projectSlug,
            projectDir: effectiveProjectDir,
          });

          // Get or create a cached adapter for this local project
          if (!localAdapterCache.has(effectiveProjectDir)) {
            // Create a base adapter for local filesystem operations
            const baseAdapter = await getAdapter();
            localAdapterCache.set(effectiveProjectDir, baseAdapter);
            logger.debug("[universal] Created local adapter for project", {
              projectSlug,
              projectDir: effectiveProjectDir,
            });
          }
          effectiveAdapter = localAdapterCache.get(effectiveProjectDir)!;

          // Load project-specific config for local projects
          // This ensures each project uses its own veryfront.config.ts
          try {
            effectiveConfig = await timeAsync(
              "config:load-project",
              () => getConfig(effectiveProjectDir, effectiveAdapter),
            );
            logger.debug("[universal] Loaded project-specific config", {
              projectSlug,
              projectDir: effectiveProjectDir,
              defaultLayout: effectiveConfig?.defaultLayout,
              router: effectiveConfig?.router,
            });
          } catch (err) {
            logger.warn("[universal] Failed to load project config, using defaults", {
              projectSlug,
              projectDir: effectiveProjectDir,
              error: getErrorMessage(err),
            });
          }
        } else if (isProxyMode && projectSlug) {
          // For proxy mode (API-backed) projects, don't pass global config
          // This forces createContextFromHandler to load project-specific config via the API adapter
          effectiveConfig = undefined;
          logger.debug("[universal] Proxy mode - will load config via API adapter", {
            projectSlug,
            hasToken: !!proxyToken,
          });
        }

        // Create handler context
        const ctx: HandlerContext = {
          projectDir: effectiveProjectDir,
          adapter: effectiveAdapter,
          mode: opts.mode ?? "production",
          moduleServerUrl: opts.moduleServerUrl,
          securityConfig: securityLoader.getSecurityConfig(),
          cspUserHeader: securityLoader.getCspUserHeader(),
          debug: opts.debug,
          config: effectiveConfig,
          parsedDomain,
          projectSlug,
          projectId,
          releaseId,
          proxyToken: isLocalProject ? undefined : proxyToken, // Don't pass token for local projects
          proxyEnvironment: isLocalProject ? "preview" : proxyEnv, // Local projects are always preview
          environmentName,
          routeRegistry: registry,
        };

        // Track metrics
        await timeAsync("metrics:inc-request", () => metrics.incRequest());

        // Execute handler chain
        const response = await withSpan(
          SpanNames.HANDLER_EXECUTE,
          () => registry.execute(req, ctx),
          {
            "handler.project_slug": projectSlug || "unknown",
            "handler.path": _url.pathname,
            "handler.method": req.method,
          },
        );

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

      // Skip timeout for monitoring endpoints
      const shouldApplyTimeout = !isMonitoringPath(_url.pathname);

      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      try {
        const executeWithContext = spanInfo?.context
          ? () => withContext(spanInfo.context, executeHandler)
          : executeHandler;

        if (shouldApplyTimeout) {
          response = await Promise.race([
            executeWithContext(),
            new Promise<never>((_, reject) => {
              timeoutId = setTimeout(() => reject(TIMEOUT_SENTINEL), REQUEST_TIMEOUT_MS);
            }),
          ]);
        } else {
          response = await executeWithContext();
        }
      } catch (e) {
        if (e === TIMEOUT_SENTINEL) {
          logger.warn("[universal] Request timed out", {
            path: _url.pathname,
            method: req.method,
            timeoutMs: REQUEST_TIMEOUT_MS,
          });
          response = new Response(
            JSON.stringify({
              error: "Request timeout",
              timeoutMs: REQUEST_TIMEOUT_MS,
              path: _url.pathname,
            }),
            {
              status: HTTP_GATEWAY_TIMEOUT,
              headers: { "Content-Type": "application/json" },
            },
          );
        } else {
          error = e instanceof Error ? e : new Error(String(e));
          response = new Response("Internal Server Error", { status: 500 });
        }
      } finally {
        // Clear timeout to prevent test leaks
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
      }

      // End the span with status
      endServerSpan(span, response.status, error);

      return response;
    } finally {
      stopTotal();
      if (perfRequestId) {
        endRequest(perfRequestId);
      }
    }
  };

  // Attach ready promise for external initialization tracking
  handler.ready = readyPromise;

  return handler;
}

// Re-export types and utilities for backward compatibility
export type { HandlerContext } from "../handlers/types.ts";
export { RouteRegistry } from "#veryfront/routing/registry/index.ts";
export { BaseHandler } from "../handlers/response/base.ts";
