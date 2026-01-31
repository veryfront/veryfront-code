/**
 * Universal Veryfront HTTP handler - Modular Architecture
 *
 * Runtime-agnostic HTTP handler using handler-based architecture
 */

import {
  endRequest,
  isEnabled as isPerfEnabled,
  startRequest,
  startTimer,
  timeAsync,
} from "#veryfront/utils";
import { getBaseLogger } from "#veryfront/utils/logger/logger.ts";
import {
  type RequestContext,
  runWithRequestContextAsync,
} from "#veryfront/utils/logger/request-context.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { isExtendedFSAdapter } from "#veryfront/platform/adapters/fs/wrapper.ts";
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
import type { HandlerContext } from "../handlers/types.ts";
import { parseProjectDomain } from "../utils/domain-parser.ts";
import { getEnvironmentType, lookupProjectByDomain } from "../utils/domain-lookup.ts";
import { parseProxyEnvironment } from "./proxy-environment.ts";
import { getErrorMessage } from "#veryfront/errors/veryfront-error.ts";
import { runtime } from "#veryfront/platform/adapters/detect.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { RouteRegistry } from "#veryfront/routing/registry/index.ts";
import { SecurityConfigLoader } from "#veryfront/security/http/config.ts";
import { getConfig } from "#veryfront/config/loader.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { createRequestContext } from "../context/request-context.ts";
import { buildEnrichedContext } from "../context/enriched-context.ts";
import { computeContentSourceId } from "../../cache/keys.ts";
import { AuthHandler } from "#veryfront/security/http/auth.ts";
import { CorsHandler } from "../handlers/response/cors.ts";
import { HealthHandler } from "../handlers/monitoring/health.handler.ts";
import { MetricsHandler } from "../handlers/monitoring/metrics.handler.ts";
import { ClientLogHandler } from "../handlers/monitoring/client-log.handler.ts";
import { MemoryDebugHandler } from "../handlers/monitoring/memory.handler.ts";
import { DevEndpointsHandler } from "../handlers/dev/endpoints.handler.ts";
import { DevFileHandler } from "../handlers/dev/files/index.ts";
import { DebugContextHandler } from "../handlers/dev/debug-context.handler.ts";
import { StylesCSSHandler } from "../handlers/dev/styles-css.handler.ts";
import { StudioEndpointsHandler } from "../handlers/studio/endpoints.handler.ts";
import { StaticHandler } from "../handlers/request/static.handler.ts";
import { SnippetHandler } from "../handlers/request/snippet.handler.ts";
import { LibModulesHandler } from "../handlers/request/lib-modules.handler.ts";
import { CSSHandler } from "../handlers/request/css.handler.ts";
import { RSCHandler } from "../handlers/request/rsc/index.ts";
import { ModuleHandler } from "../handlers/request/module/index.ts";
import { ApiHandlerWrapper } from "../handlers/request/api/index.ts";
import { SSRHandler } from "../handlers/request/ssr/index.ts";
import { NotFoundHandler } from "../handlers/response/not-found.ts";
import { HMRHandler } from "../handlers/preview/hmr.handler.ts";
import { MarkdownPreviewHandler } from "../handlers/preview/markdown-preview.handler.ts";
import { OpenAPIHandler } from "../handlers/request/openapi.handler.ts";
import { OpenAPIDocsHandler } from "../handlers/request/openapi-docs.handler.ts";
import { DevDashboardHandler } from "../handlers/dev/dashboard/index.ts";
import { ProjectsHandler } from "../handlers/dev/projects/index.ts";
import { requestTracker } from "./request-tracker.ts";
import { projectIsolation } from "./project-isolation.ts";

// Re-export from dedicated module for lightweight imports
export { parseProxyEnvironment, type ProxyEnvironment } from "./proxy-environment.ts";

const logger = getBaseLogger("SERVER");

/** Check if host is a private/internal IP address */
function isInternalHost(host: string): boolean {
  const hostname = host.split(":")[0] ?? "";

  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
    return true;
  }

  const ipv4Match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!ipv4Match) return false;

  const a = Number(ipv4Match[1]);
  const b = Number(ipv4Match[2]);

  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16

  return false;
}

/** Monitoring paths that should skip domain lookup */
const MONITORING_PATHS = new Set(["/healthz", "/readyz", "/_health", "/_metrics"]);

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

/** Lightweight paths that should skip concurrency limiting (modules, static assets) */
const LIGHTWEIGHT_PATH_PREFIXES = [
  "/_vf_modules/",
  "/_veryfront/modules/",
  "/_veryfront/preview-hmr.js",
  "/_veryfront/studio-bridge.js",
  "/_vf/css/",
  "/_lib_modules/",
];

function isLightweightPath(pathname: string): boolean {
  return LIGHTWEIGHT_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export interface UniversalHandlerOptions {
  projectDir: string;
  /** When true, expose additional debug logging. */
  debug?: boolean;
  /** Module server URL for ESM imports (e.g., 'http://localhost:8765') */
  moduleServerUrl?: string;
  /** Pre-loaded config (avoids re-loading via FSAdapter) */
  config?: VeryfrontConfig;
  /** Map of local project slugs to their filesystem paths (for unified dev server) */
  localProjects?: Record<string, string>;
  /** Override environment config for isLocalDev (dev server passes { isLocalDev: true }) */
  envConfig?: import("../context/request-context.ts").EnvConfig;
  /** Default project slug when not provided via proxy headers (for tests/local mode) */
  defaultProjectSlug?: string;
  /** Default project ID when not provided via proxy headers (for tests/local mode) */
  defaultProjectId?: string;
  /** Default environment for standalone mode (preview or production). Defaults to preview for safety. */
  defaultEnvironment?: "preview" | "production";
}

export function createVeryfrontHandler(
  projectDir: string,
  adapter: RuntimeAdapter,
  opts: UniversalHandlerOptions = { projectDir },
): ((req: Request) => Promise<Response>) & { ready?: Promise<void> } {
  const isDebugEnabled = !!(opts.debug || adapter.env.get("VERYFRONT_DEBUG"));

  function logDebug(message: string, extra?: Record<string, unknown>): void {
    if (!isDebugEnabled) return;
    if (extra) {
      logger.debug(message, extra);
      return;
    }
    logger.debug(message);
  }

  logDebug("[universal] handler initialized", { projectDir });

  const securityLoader = new SecurityConfigLoader(projectDir, adapter, opts.config);

  let config: VeryfrontConfig | undefined = opts.config;
  const configPromise =
    (opts.config ? Promise.resolve(opts.config) : getConfig(projectDir, adapter))
      .then((c) => {
        config = c;
        return c;
      })
      .catch((error) => {
        logger.warn("[universal] Failed to load config, using defaults", {
          error: getErrorMessage(error),
        });
        return undefined;
      });

  const registry = new RouteRegistry({
    debug: opts.debug,
    enableMetrics: true,
  });

  const apiHandler = new ApiHandlerWrapper(projectDir, adapter);

  registry.registerAll([
    new AuthHandler(),
    new HMRHandler(),
    new CorsHandler(),
    new HealthHandler(),
    new MetricsHandler(),
    new MemoryDebugHandler(),
    new ClientLogHandler(),
    new DevEndpointsHandler(),
    new StylesCSSHandler(),
    new DebugContextHandler(),
    new OpenAPIHandler(),
    new OpenAPIDocsHandler(),
    new DevDashboardHandler(),
    new ProjectsHandler(),
    new StudioEndpointsHandler(),
    new CSSHandler(),
    new DevFileHandler(),
    new SnippetHandler(),
    new StaticHandler(),
    new LibModulesHandler(),
    new RSCHandler(),
    new ModuleHandler(),
    apiHandler,
    new MarkdownPreviewHandler(),
    new SSRHandler(),
    new NotFoundHandler(),
  ]);

  const isProxyMode = opts.config?.fs?.veryfront?.proxyMode === true;

  const localAdapterCache = new Map<string, RuntimeAdapter>();
  const standardProjectDirs = ["data/projects", "projects", "examples"];
  const localProjectCache = new Map<string, string>();

  async function findLocalProjectPath(
    slug: string,
    headerPath?: string,
  ): Promise<string | undefined> {
    if (headerPath) {
      localProjectCache.set(slug, headerPath);
      return headerPath;
    }

    const cached = localProjectCache.get(slug);
    if (cached) return cached;

    for (const dir of standardProjectDirs) {
      const projectPath = `${dir}/${slug}`;

      try {
        const stat = await adapter.fs.stat(projectPath);
        if (!stat?.isDirectory) continue;

        const [hasApp, hasPages, hasComponents] = await Promise.all([
          adapter.fs.stat(`${projectPath}/app`).then((s) => s?.isDirectory).catch(() => false),
          adapter.fs.stat(`${projectPath}/pages`).then((s) => s?.isDirectory).catch(() => false),
          adapter.fs.stat(`${projectPath}/components`).then((s) => s?.isDirectory).catch(() =>
            false
          ),
        ]);

        if (!hasApp && !hasPages && !hasComponents) continue;

        const absolutePath = projectPath.startsWith("/") ? projectPath : `${cwd()}/${projectPath}`;
        localProjectCache.set(slug, absolutePath);
        logger.debug("[universal] Discovered local project", { slug, path: absolutePath });
        return absolutePath;
      } catch {
        // Directory doesn't exist, continue
      }
    }

    return undefined;
  }

  const readyPromise = isProxyMode ? Promise.resolve() : apiHandler.initialize().catch((error) => {
    logger.error("[universal] API handler initialization failed", {
      error: getErrorMessage(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  });

  if (isProxyMode) {
    logger.debug("[universal] Running in proxy mode - lazy initialization enabled");
  }

  const handler = async (req: Request): Promise<Response> => {
    const perfEnabled = isPerfEnabled();
    const perfRequestId = perfEnabled
      ? (req.headers.get("x-request-id") ?? crypto.randomUUID())
      : undefined;

    if (perfRequestId) startRequest(perfRequestId);
    const stopTotal = startTimer("total");

    const url = new URL(req.url);

    if (isMonitoringPath(url.pathname)) {
      try {
        await readyPromise;
        if (!isProxyMode) await securityLoader.ensureLoaded();

        const minimalCtx: HandlerContext = {
          projectDir,
          adapter,
          securityConfig: securityLoader.getSecurityConfig(),
          cspUserHeader: securityLoader.getCspUserHeader(),
          debug: opts.debug,
          config,
        };

        const response = await registry.execute(req, minimalCtx);
        return response ?? new Response("Not Found", { status: 404 });
      } finally {
        stopTotal();
        if (perfRequestId) endRequest(perfRequestId);
      }
    }

    const trackingRequestId = req.headers.get("x-request-id") ?? crypto.randomUUID();

    const hostHeader = req.headers.get("host") ?? url.host;
    const domain = hostHeader.replace(/:\d+$/, "");
    const projectSlugHeader = req.headers.get("x-project-slug") ?? undefined;
    const projectIdHeader = req.headers.get("x-project-id") ?? undefined;
    const releaseIdHeader = req.headers.get("x-release-id") ?? undefined;
    const branchIdHeader = req.headers.get("x-branch-id") ?? undefined;
    const branchNameHeader = req.headers.get("x-branch-name") ?? undefined;

    const reqLogger = logger.child({
      requestId: trackingRequestId,
      request_url: req.url,
      domain,
      project_slug: projectSlugHeader,
      project_id: projectIdHeader,
      release_id: releaseIdHeader,
      branch_id: branchIdHeader,
      branch_name: branchNameHeader,
      pathname: url.pathname,
    });

    const loggerContext: RequestContext = {
      logger: reqLogger,
      requestId: trackingRequestId,
      projectSlug: projectSlugHeader,
      projectId: projectIdHeader,
      domain,
    };

    return runWithRequestContextAsync(loggerContext, async () => {
      const parentContext = extractContext(req.headers);
      const spanInfo = startServerSpan(req.method, url.pathname, parentContext);
      const span = spanInfo?.span;

      if (span) {
        setSpanAttributes(span, {
          "http.url": req.url,
          "http.host": req.headers.get("host") || url.host,
          "http.scheme": url.protocol.replace(":", ""),
        });
      }

      const earlyProjectSlug = req.headers.get("x-project-slug") || undefined;
      const earlyEnv = req.headers.get("x-environment") || undefined;
      const earlyReleaseId = req.headers.get("x-release-id") || undefined;

      requestTracker.start(
        trackingRequestId,
        earlyProjectSlug,
        url.pathname,
        req.method,
        earlyEnv || undefined,
        earlyReleaseId || undefined,
      );

      const shouldCheckIsolation = !isLightweightPath(url.pathname);
      const isolationCheck = shouldCheckIsolation
        ? projectIsolation.checkRequest(earlyProjectSlug)
        : { allowed: true };

      if (!isolationCheck.allowed) {
        requestTracker.complete(trackingRequestId, 503, false);

        const message = isolationCheck.reason === "circuit_open"
          ? `Service temporarily unavailable for project. Retry after ${
            Math.ceil((isolationCheck.waitTimeMs || 0) / 1000)
          } seconds.`
          : "Too many concurrent requests for this project. Please retry.";

        const response = new Response(
          JSON.stringify({
            error: message,
            reason: isolationCheck.reason,
            retryAfterMs: isolationCheck.waitTimeMs,
          }),
          {
            status: 503,
            headers: {
              "Content-Type": "application/json",
              ...(isolationCheck.waitTimeMs
                ? { "Retry-After": String(Math.ceil(isolationCheck.waitTimeMs / 1000)) }
                : {}),
            },
          },
        );

        endServerSpan(span, response.status);
        return response;
      }

      if (shouldCheckIsolation) {
        projectIsolation.startRequest(earlyProjectSlug);
      }

      try {
        await readyPromise;

        await timeAsync("security:load", async () => {
          if (isProxyMode) return;
          await securityLoader.ensureLoaded();
        });

        await timeAsync("config:load", async () => {
          await configPromise;
        });

        const executeHandler = async (): Promise<Response> => {
          const reqCtx = createRequestContext(req, opts.envConfig);

          const wsSlugOverride = url.searchParams.get("x-project-slug") || undefined;
          const proxyProjectPath = req.headers.get("x-project-path") || undefined;

          let proxyEnv = parseProxyEnvironment(
            req.headers.get("x-environment") || url.searchParams.get("x-environment"),
          );

          const forwardedHost = req.headers.get("x-forwarded-host") || undefined;
          const host = forwardedHost || req.headers.get("host") || url.host;
          const parsedDomain = parseProjectDomain(host);

          const configuredSlug = config?.fs?.veryfront?.projectSlug;
          let projectSlug = reqCtx.slug || wsSlugOverride || configuredSlug ||
            opts.defaultProjectSlug;

          const proxyToken = reqCtx.token || undefined;
          const proxyReleaseId = req.headers.get("x-release-id") || undefined;
          const proxyProjectId = req.headers.get("x-project-id") || undefined;
          const proxyContentSourceId = req.headers.get("x-content-source-id") || undefined;

          let projectId: string | undefined = proxyProjectId || opts.defaultProjectId;
          let releaseId: string | undefined = proxyReleaseId;
          let environmentName: string | undefined;

          logger.debug("[universal] config state", {
            hasConfig: !!config,
            hasFsConfig: !!config?.fs,
            hasVeryfrontConfig: !!config?.fs?.veryfront,
            configuredSlug,
            reqCtxSlug: reqCtx.slug,
            reqCtxMode: reqCtx.mode,
            reqCtxBranch: reqCtx.branch,
            parsedDomainSlug: parsedDomain.slug,
            finalProjectSlug: projectSlug,
            isVeryfrontDomain: parsedDomain.isVeryfrontDomain,
            isLocalDev: reqCtx.isLocalDev,
            proxyReleaseId,
            proxyProjectId,
          });

          const shouldSkipDomainLookup = isInternalHost(host);

          if (
            !projectSlug && !parsedDomain.isVeryfrontDomain && config?.fs?.veryfront &&
            !shouldSkipDomainLookup
          ) {
            const effectiveToken = proxyToken || config.fs.veryfront.apiToken || "";
            const baseUrl =
              (config.fs.veryfront as { baseUrl?: string; apiBaseUrl?: string }).baseUrl ||
              config.fs.veryfront.apiBaseUrl ||
              "https://api.veryfront.com";

            const lookupHost = forwardedHost || host;

            if (effectiveToken) {
              logger.debug("[universal] Custom domain detected, looking up project", {
                host: lookupHost,
                originalHost: host,
                forwardedHost,
                hasProxyToken: !!proxyToken,
                hasConfigToken: !!config.fs.veryfront.apiToken,
              });

              const lookupResult = await withSpan(
                SpanNames.DOMAIN_LOOKUP,
                () =>
                  lookupProjectByDomain(lookupHost, {
                    apiBaseUrl: baseUrl,
                    apiToken: effectiveToken,
                  }),
                { "domain.host": lookupHost, "domain.original_host": host },
              );

              if (lookupResult) {
                projectSlug = lookupResult.project_slug;
                projectId = projectId || lookupResult.project_id;
                releaseId = releaseId || lookupResult.release_id || undefined;
                environmentName = lookupResult.environment?.name;

                if (!proxyEnv) proxyEnv = getEnvironmentType(lookupResult);

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

          if (
            parsedDomain.isVeryfrontDomain &&
            parsedDomain.isDraft === false &&
            projectSlug &&
            !releaseId &&
            !proxyToken &&
            config?.fs?.veryfront &&
            !shouldSkipDomainLookup
          ) {
            const effectiveToken = proxyToken || config.fs.veryfront.apiToken || "";
            const baseUrl =
              (config.fs.veryfront as { baseUrl?: string; apiBaseUrl?: string }).baseUrl ||
              config.fs.veryfront.apiBaseUrl ||
              "https://api.veryfront.com";

            if (effectiveToken) {
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

          if (parsedDomain.slug && configuredSlug && parsedDomain.slug !== configuredSlug) {
            logDebug("[universal] Project slug mismatch", {
              fromUrl: parsedDomain.slug,
              fromConfig: configuredSlug,
              usingSlug: projectSlug,
            });
          }

          if (reqCtx.token) {
            logDebug("[universal] Request context resolved", {
              projectSlug,
              mode: reqCtx.mode,
              branch: reqCtx.branch,
              environment: proxyEnv,
              hasToken: !!reqCtx.token,
            });
          }

          if (span && projectSlug) {
            setSpanAttributes(span, {
              "veryfront.project_slug": projectSlug,
              "veryfront.environment": proxyEnv || "unknown",
            });
          }

          const isProjectsPath = url.pathname === "/" ||
            url.pathname.startsWith("/_projects") ||
            url.pathname === "/_vf/api/projects";

          if (
            !projectSlug && !parsedDomain.slug && parsedDomain.isVeryfrontDomain && isProjectsPath
          ) {
            const { PROJECTS_SHELL_HTML } = await import("../handlers/dev/projects/html-shell.ts");
            const { handleProjectsAPI } = await import("../handlers/dev/projects/api.ts");
            const { handleProjectsUI } = await import("../handlers/dev/projects/ui-handler.ts");

            if (
              url.pathname === "/" || url.pathname === "/_projects" ||
              url.pathname === "/_projects/"
            ) {
              return new Response(PROJECTS_SHELL_HTML, {
                status: 200,
                headers: { "Content-Type": "text/html; charset=utf-8" },
              });
            }

            if (url.pathname.startsWith("/_projects/ui/")) {
              const response = await handleProjectsUI(req);
              if (response) return response;
            }

            if (url.pathname.startsWith("/_projects/api/")) {
              const response = await handleProjectsAPI(req, {} as HandlerContext);
              if (response) return response;
            }

            if (url.pathname === "/_vf/api/projects") {
              const nativeFs = createFileSystem();
              const basePath = cwd();

              for (const dir of standardProjectDirs) {
                try {
                  const dirPath = `${basePath}/${dir}`;
                  if (!(await nativeFs.exists(dirPath))) continue;

                  for await (const entry of nativeFs.readDir(dirPath)) {
                    if (entry.name.startsWith(".") || !entry.isDirectory) continue;

                    const projectPath = `${dirPath}/${entry.name}`;
                    try {
                      const [hasApp, hasPages, hasComponents] = await Promise.all([
                        nativeFs.exists(`${projectPath}/app`),
                        nativeFs.exists(`${projectPath}/pages`),
                        nativeFs.exists(`${projectPath}/components`),
                      ]);

                      if (hasApp || hasPages || hasComponents) {
                        localProjectCache.set(entry.name, projectPath);
                      }
                    } catch {
                      // Skip entries that can't be stat'd
                    }
                  }
                } catch {
                  // Directory doesn't exist, skip
                }
              }

              const localProjects = Array.from(localProjectCache.entries()).map(([slug, path]) => ({
                id: slug,
                name: slug,
                slug,
                path,
                updated_at: new Date().toISOString(),
              }));

              return new Response(JSON.stringify({ data: localProjects }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              });
            }

            return new Response("Not found", { status: 404 });
          }

          let effectiveProjectDir = projectDir;
          let effectiveAdapter = adapter;

          const localProjectPath = projectSlug
            ? await findLocalProjectPath(projectSlug, proxyProjectPath)
            : undefined;

          const isLocalProject = !!localProjectPath;
          let effectiveConfig: VeryfrontConfig | undefined = config;

          if (isLocalProject && localProjectPath) {
            effectiveProjectDir = localProjectPath;

            logger.debug("[universal] Using local project (filesystem-first)", {
              projectSlug,
              projectDir: effectiveProjectDir,
            });

            if (!localAdapterCache.has(effectiveProjectDir)) {
              const baseAdapter = await runtime.get();
              localAdapterCache.set(effectiveProjectDir, baseAdapter);
              logger.debug("[universal] Created local adapter for project", {
                projectSlug,
                projectDir: effectiveProjectDir,
              });
            }

            effectiveAdapter = localAdapterCache.get(effectiveProjectDir)!;

            try {
              effectiveConfig = await timeAsync(
                "config:load-project",
                () => getConfig(effectiveProjectDir, effectiveAdapter),
              );

              logger.debug("[universal] Loaded project-specific config", {
                projectSlug,
                projectDir: effectiveProjectDir,
                layout: effectiveConfig?.layout,
                router: effectiveConfig?.router,
              });
            } catch (error) {
              logger.warn("[universal] Failed to load project config, using defaults", {
                projectSlug,
                projectDir: effectiveProjectDir,
                error: getErrorMessage(error),
              });
            }
          } else if (isProxyMode && projectSlug && proxyToken) {
            try {
              effectiveConfig = await timeAsync("config:load-proxy-project", () => {
                if (
                  isExtendedFSAdapter(effectiveAdapter.fs) && effectiveAdapter.fs.runWithContext
                ) {
                  return effectiveAdapter.fs.runWithContext(
                    projectSlug,
                    proxyToken,
                    () =>
                      getConfig(effectiveProjectDir, effectiveAdapter, {
                        cacheKey: projectId || projectSlug,
                      }),
                    projectId,
                    {
                      productionMode: proxyEnv === "production",
                      releaseId,
                      branch: reqCtx.branch || parsedDomain.branch || null,
                      environmentName,
                    },
                  );
                }

                return getConfig(effectiveProjectDir, effectiveAdapter, {
                  cacheKey: projectId || projectSlug,
                });
              });

              logger.debug("[universal] Loaded config in proxy mode", {
                projectSlug,
                hasConfig: !!effectiveConfig,
                layout: effectiveConfig?.layout,
                router: effectiveConfig?.router,
              });
            } catch (error) {
              logger.warn("[universal] Failed to load proxy config, using defaults", {
                projectSlug,
                error: getErrorMessage(error),
              });
            }
          }

          let resolvedEnvironment = proxyEnv === "preview" || proxyEnv === "production"
            ? proxyEnv
            : reqCtx.mode;

          if (
            isProxyMode && resolvedEnvironment === "production" && projectSlug && !releaseId &&
            !isLocalProject
          ) {
            logger.error("[universal] Missing releaseId in proxy mode (production)", {
              projectSlug,
              projectId,
              environmentName,
              host,
              proxyEnv,
              resolvedEnvironment,
            });

            return new Response(
              JSON.stringify({
                error: "Missing releaseId for production request in proxy mode",
                projectSlug,
                environment: resolvedEnvironment,
              }),
              { status: 502, headers: { "Content-Type": "application/json" } },
            );
          }

          const isStandaloneWithoutRelease = !isProxyMode &&
            resolvedEnvironment === "production" &&
            !releaseId &&
            !reqCtx.isLocalDev &&
            !isLocalProject;

          if (isStandaloneWithoutRelease) {
            const fallbackEnv = opts.defaultEnvironment ?? "preview";
            logger.debug(
              "[universal] Standalone mode without releaseId, using fallback environment",
              {
                projectSlug,
                resolvedEnvironment,
                fallbackEnv,
              },
            );

            resolvedEnvironment = fallbackEnv;

            if (fallbackEnv === "production" && !releaseId) {
              releaseId = "standalone-dev";
              logger.debug("[universal] Using synthetic releaseId for standalone production mode", {
                projectSlug,
                releaseId,
              });
            }
          }

          const contentSourceId = proxyContentSourceId ??
            computeContentSourceId(
              reqCtx.isLocalDev || isLocalProject,
              resolvedEnvironment,
              reqCtx.branch,
              releaseId,
            );

          const enrichedContext = effectiveConfig && projectSlug
            ? buildEnrichedContext({
              projectId: projectId ?? projectSlug,
              projectSlug,
              projectDir: effectiveProjectDir,
              token: isLocalProject ? "" : (proxyToken ?? ""),
              environment: resolvedEnvironment,
              branch: reqCtx.branch,
              isLocalDev: reqCtx.isLocalDev || isLocalProject,
              contentSourceId,
              parsedDomain,
              adapter: effectiveAdapter,
              config: effectiveConfig,
              releaseId,
              environmentName,
              moduleServerUrl: opts.moduleServerUrl,
              debug: opts.debug,
            })
            : undefined;

          const ctx: HandlerContext = {
            projectDir: effectiveProjectDir,
            adapter: effectiveAdapter,
            moduleServerUrl: opts.moduleServerUrl,
            securityConfig: securityLoader.getSecurityConfig(),
            cspUserHeader: securityLoader.getCspUserHeader(),
            debug: opts.debug,
            config: effectiveConfig,
            parsedDomain,
            projectSlug,
            projectId,
            releaseId,
            proxyToken: isLocalProject ? undefined : proxyToken,
            environmentName,
            resolvedEnvironment,
            requestContext: { ...reqCtx, mode: resolvedEnvironment },
            routeRegistry: registry,
            enriched: enrichedContext,
          };

          await timeAsync("metrics:inc-request", () => metrics.incRequest());

          const response = await withSpan(
            SpanNames.HANDLER_EXECUTE,
            () => registry.execute(req, ctx),
            {
              "handler.project_slug": projectSlug || "unknown",
              "handler.path": url.pathname,
              "handler.method": req.method,
            },
          );

          if (response) return response;

          logDebug("[universal] No handler produced response (unexpected)", { path: url.pathname });
          return new Response("Internal Server Error", { status: 500 });
        };

        let response: Response;
        let error: Error | undefined;
        let timeoutId: ReturnType<typeof setTimeout> | undefined;

        try {
          const executeWithContext = spanInfo?.context
            ? () => withContext(spanInfo.context, executeHandler)
            : executeHandler;

          response = await Promise.race([
            executeWithContext(),
            new Promise<never>((_, reject) => {
              timeoutId = setTimeout(() => reject(TIMEOUT_SENTINEL), REQUEST_TIMEOUT_MS);
            }),
          ]);
        } catch (e) {
          if (e === TIMEOUT_SENTINEL) {
            logger.warn("[universal] Request timed out", {
              path: url.pathname,
              method: req.method,
              timeoutMs: REQUEST_TIMEOUT_MS,
            });

            response = new Response(
              JSON.stringify({
                error: "Request timeout",
                timeoutMs: REQUEST_TIMEOUT_MS,
                path: url.pathname,
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
          if (timeoutId !== undefined) clearTimeout(timeoutId);
        }

        endServerSpan(span, response.status, error);

        const isTimeout = response.status === HTTP_GATEWAY_TIMEOUT;
        requestTracker.complete(trackingRequestId, response.status, isTimeout);

        if (shouldCheckIsolation) {
          projectIsolation.completeRequest(earlyProjectSlug, isTimeout);
        }

        return response;
      } finally {
        stopTotal();
        if (perfRequestId) endRequest(perfRequestId);
      }
    });
  };

  handler.ready = readyPromise;

  return handler;
}

// Re-export types and utilities for backward compatibility
export type { HandlerContext } from "../handlers/types.ts";
export { RouteRegistry } from "#veryfront/routing/registry/index.ts";
export { BaseHandler } from "../handlers/response/base.ts";
