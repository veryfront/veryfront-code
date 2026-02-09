/**
 * Veryfront Core HTTP Handler - Composition Root
 *
 * Runtime-agnostic HTTP handler using modular architecture.
 * This file orchestrates the extracted modules for request handling.
 *
 * @module server/runtime-handler
 */

import { getBaseLogger } from "#veryfront/utils/logger/logger.ts";
import {
  type RequestContext,
  runWithRequestContextAsync,
} from "#veryfront/utils/logger/request-context.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { getConfig } from "#veryfront/config/loader.ts";
import { getErrorMessage } from "#veryfront/errors/veryfront-error.ts";
import { TIMEOUT_ERROR, UNKNOWN_ERROR } from "#veryfront/errors/error-registry.ts";
import { errorToRFC9457Response } from "#veryfront/errors/middleware/http-error-boundary.ts";
import { RouteRegistry } from "#veryfront/routing/registry/index.ts";
import { SecurityConfigLoader } from "#veryfront/security/http/config.ts";

// Re-export is at the bottom of the file
import type { HandlerContext as _HandlerContext } from "../handlers/types.ts";
import { createRequestContext } from "../context/request-context.ts";

// Handler imports
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

// Extracted modules
import {
  endRequestTracing,
  executeWithTracingContext,
  setProjectAttributes,
  setRequestAttributes,
  SpanNames,
  startRequestTracing,
  withSpan,
} from "./tracing.ts";
import {
  completeRequestTracking,
  endContentMetrics,
  endRequestLifecycle,
  incrementRequestMetrics,
  startContentMetrics,
  startRequestLifecycle,
  startRequestTracking,
  timeAsync,
} from "./request-lifecycle.ts";
import { extractRequestHeaders, resolveProject } from "./project-resolution.ts";
import {
  checkRequestIsolation,
  completeIsolatedRequest,
  createIsolationErrorResponse,
  startIsolatedRequest,
} from "./isolation.ts";
import { resolveAdapter } from "./adapter-factory.ts";
import { localProjectCache } from "./local-project-discovery.ts";
import { resolveEnvironment } from "./environment-resolution.ts";
import { buildHandlerContext, buildMinimalContext } from "./handler-context-builder.ts";
import { handleProjectsRequest, shouldHandleProjectsUI } from "./projects-handler.ts";
import { HTTP_GATEWAY_TIMEOUT, isLightweightPath, isMonitoringPath } from "./request-utils.ts";
import { withRequestTimeout } from "./timeout-manager.ts";

// Re-export from dedicated module for lightweight imports
export { parseProxyEnvironment, type ProxyEnvironment } from "./proxy-environment.ts";

const logger = getBaseLogger("SERVER");

export interface RuntimeHandlerOptions {
  projectDir: string;
  /** When true, expose additional debug logging. */
  debug?: boolean;
  /** Module server URL for ESM imports (e.g., 'http://localhost:8765') */
  moduleServerUrl?: string;
  /** Pre-loaded config (avoids re-loading via FSAdapter) */
  config?: VeryfrontConfig;
  /** Map of local project slugs to their filesystem paths (for unified dev server) */
  localProjects?: Record<string, string>;
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
  opts: RuntimeHandlerOptions = { projectDir },
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

  logDebug("[runtime-handler] handler initialized", { projectDir });

  // Seed local project cache from explicit mappings (for tests and capability injection)
  if (opts.localProjects) {
    for (const [slug, path] of Object.entries(opts.localProjects)) {
      localProjectCache.set(slug, path);
    }
    logDebug("[runtime-handler] Seeded local project cache", {
      projects: Object.keys(opts.localProjects),
    });
  }

  const securityLoader = new SecurityConfigLoader(projectDir, adapter, opts.config);

  let config: VeryfrontConfig | undefined = opts.config;
  const configPromise =
    (opts.config ? Promise.resolve(opts.config) : getConfig(projectDir, adapter))
      .then((c) => {
        config = c;
        return c;
      })
      .catch((error) => {
        logger.warn("[runtime-handler] Failed to load config, using defaults", {
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

  const readyPromise = isProxyMode ? Promise.resolve() : apiHandler.initialize().catch((error) => {
    logger.error("[runtime-handler] API handler initialization failed", {
      error: getErrorMessage(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  });

  if (isProxyMode) {
    logger.debug("[runtime-handler] Running in proxy mode - lazy initialization enabled");
  }

  const handler = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const lifecycle = startRequestLifecycle(req, url.pathname, isLightweightPath(url.pathname));

    // Fast path for monitoring endpoints
    if (isMonitoringPath(url.pathname)) {
      try {
        await readyPromise;
        if (!isProxyMode) await securityLoader.ensureLoaded();

        const minimalCtx = buildMinimalContext(
          projectDir,
          adapter,
          securityLoader.getSecurityConfig(),
          securityLoader.getCspUserHeader(),
          opts.debug,
          config,
        );

        const response = await registry.execute(req, minimalCtx);
        return response ?? new Response("Not Found", { status: 404 });
      } finally {
        endRequestLifecycle(lifecycle);
      }
    }

    // Build logger context
    const hostHeader = req.headers.get("host") ?? url.host;
    const domain = hostHeader.replace(/:\d+$/, "");
    const headers = extractRequestHeaders(req, url);

    const loggerContext: RequestContext = {
      logger: logger.child({
        requestId: lifecycle.requestId,
        request_url: req.url,
        domain,
        project_slug: headers.projectSlug,
        project_id: headers.projectId,
        release_id: headers.releaseId,
        branch_id: headers.branchId,
        branch_name: headers.branchName,
        pathname: url.pathname,
      }),
      requestId: lifecycle.requestId,
      projectSlug: headers.projectSlug,
      projectId: headers.projectId,
      domain,
    };

    return runWithRequestContextAsync(loggerContext, async () => {
      const spanInfo = startRequestTracing(req, url.pathname);
      setRequestAttributes(spanInfo.span, req, url);

      startRequestTracking(
        lifecycle.requestId,
        headers.projectSlug,
        url.pathname,
        req.method,
        headers.environment,
        headers.releaseId,
      );

      startContentMetrics();

      // Check isolation
      const isolationCheck = checkRequestIsolation(
        headers.projectSlug,
        lifecycle.shouldCheckIsolation,
      );

      if (!isolationCheck.allowed) {
        completeRequestTracking(lifecycle.requestId, 503, false);
        const response = createIsolationErrorResponse(isolationCheck);
        endRequestTracing(spanInfo.span, response.status);
        return response;
      }

      startIsolatedRequest(headers.projectSlug, lifecycle.shouldCheckIsolation);

      try {
        await readyPromise;

        await timeAsync("security:load", async () => {
          if (isProxyMode) return;
          await securityLoader.ensureLoaded();
        });

        await timeAsync("config:load", async () => {
          await configPromise;
        });

        let isLocalProject = false;

        const executeHandler = async (): Promise<Response> => {
          const reqCtx = createRequestContext(req);

          const wsSlugOverride = url.searchParams.get("x-project-slug") || undefined;

          // Resolve project from various sources
          const projectRes = await resolveProject(req, url, headers, {
            config,
            reqCtx,
            defaultProjectSlug: opts.defaultProjectSlug,
            defaultProjectId: opts.defaultProjectId,
            wsSlugOverride,
          });

          setProjectAttributes(spanInfo.span, projectRes.projectSlug, projectRes.proxyEnv);

          // Handle projects discovery UI
          if (
            shouldHandleProjectsUI(url.pathname, projectRes.projectSlug, projectRes.parsedDomain)
          ) {
            const response = await handleProjectsRequest(
              req,
              url,
              buildMinimalContext(
                projectDir,
                adapter,
                securityLoader.getSecurityConfig(),
                securityLoader.getCspUserHeader(),
                opts.debug,
                config,
              ),
            );
            if (response) return response;
          }

          // Resolve adapter and config for project
          const adapterRes = await resolveAdapter({
            projectDir,
            adapter,
            config,
            projectSlug: projectRes.projectSlug,
            projectId: projectRes.projectId,
            proxyToken: reqCtx.token,
            releaseId: projectRes.releaseId,
            proxyEnv: projectRes.proxyEnv,
            branch: reqCtx.branch,
            environmentName: projectRes.environmentName,
            parsedDomain: projectRes.parsedDomain,
            headerProjectPath: headers.projectPath,
            isProxyMode,
          });

          isLocalProject = !!adapterRes.isLocalProject;

          // Resolve environment and validate
          const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || url.host;
          const envRes = resolveEnvironment({
            proxyEnv: projectRes.proxyEnv,
            reqCtxMode: reqCtx.mode,
            releaseId: projectRes.releaseId,
            projectSlug: projectRes.projectSlug,
            projectId: projectRes.projectId,
            environmentName: projectRes.environmentName,
            host,
            isLocalProject: adapterRes.isLocalProject,
            isProxyMode,
            pathname: url.pathname,
            defaultEnvironment: opts.defaultEnvironment,
          });

          if (envRes.errorResponse) {
            return envRes.errorResponse;
          }

          // Build handler context
          const ctx = buildHandlerContext({
            projectDir: adapterRes.projectDir,
            adapter: adapterRes.adapter,
            securityConfig: securityLoader.getSecurityConfig(),
            cspUserHeader: securityLoader.getCspUserHeader(),
            debug: opts.debug,
            config: adapterRes.config,
            parsedDomain: projectRes.parsedDomain,
            projectSlug: projectRes.projectSlug,
            projectId: projectRes.projectId,
            releaseId: envRes.releaseId,
            proxyToken: reqCtx.token,
            environmentName: projectRes.environmentName,
            resolvedEnvironment: envRes.resolvedEnvironment ?? "preview",
            requestContext: reqCtx,
            routeRegistry: registry,
            isLocalProject: adapterRes.isLocalProject,
            moduleServerUrl: opts.moduleServerUrl,
          });

          await incrementRequestMetrics();

          const response = await withSpan(
            SpanNames.HANDLER_EXECUTE,
            () => registry.execute(req, ctx),
            {
              "handler.project_slug": projectRes.projectSlug || "unknown",
              "handler.path": url.pathname,
              "handler.method": req.method,
            },
          );

          if (response) return response;

          logDebug("[runtime-handler] No handler produced response (unexpected)", {
            path: url.pathname,
          });
          // RFC 9457 error response for no handler case (env-aware filtering)
          const noHandlerError = UNKNOWN_ERROR.create({
            detail: "No handler available to process this request",
            instance: url.pathname,
          });
          return errorToRFC9457Response(noHandlerError, ctx, req);
        };

        const { response, error } = await withRequestTimeout(
          () => executeWithTracingContext(spanInfo, executeHandler),
          url.pathname,
          req.method,
        );

        endRequestTracing(spanInfo.span, response.status, error);

        endContentMetrics({
          requestId: lifecycle.requestId,
          pathname: url.pathname,
          mode: headers.environment || "unknown",
        });

        const isTimeout = response.status === HTTP_GATEWAY_TIMEOUT;
        completeRequestTracking(lifecycle.requestId, response.status, isTimeout);
        completeIsolatedRequest(headers.projectSlug, lifecycle.shouldCheckIsolation, isTimeout);

        return response;
      } finally {
        endRequestLifecycle(lifecycle);
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
