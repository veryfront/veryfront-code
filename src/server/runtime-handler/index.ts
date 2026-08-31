/**
 * Veryfront Core HTTP Handler - Composition Root
 *
 * Runtime-agnostic HTTP handler using modular architecture.
 * This file orchestrates the extracted modules for request handling.
 *
 * @module server/runtime-handler
 */

import { getBaseLogger, type RequestContext, runWithRequestContextAsync } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { inheritRequestPeerProvenance } from "#veryfront/platform/adapters/runtime/shared/request-peer.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { getConfig } from "#veryfront/config/loader.ts";
import {
  errorToRFC9457Response,
  getErrorMessage,
  isVeryfrontError,
  SOURCE_SNAPSHOT_FRESHNESS_UNAVAILABLE,
  UNKNOWN_ERROR,
} from "#veryfront/errors";
import { RouteRegistry } from "#veryfront/routing/registry/index.ts";
import type { Handler } from "#veryfront/types";
import { SecurityConfigLoader } from "#veryfront/security/http/config.ts";
import { runWithExactSourceIntegrationPolicy } from "#veryfront/integrations/source-policy-context.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { isTruthyEnvValue } from "#veryfront/utils/constants/env.ts";
import {
  isConfigOptionalControlPlaneRunRequest,
  isSignedChannelDispatch,
  isSignedControlPlaneDispatch,
} from "#veryfront/channels/control-plane.ts";
import {
  type ApplicationAuthHandlerResult,
  createApplicationAuthRequestHandler,
} from "#veryfront/security/application-auth/application-auth-runtime.ts";
import { applyCORSHeaders } from "#veryfront/security/http/cors/headers.ts";
import { isCspReportRequest } from "#veryfront/security/http/csp-report-endpoint.ts";
import { isPreflightRequest } from "#veryfront/security/http/cors/preflight.ts";
import { getEffectiveRequestOrigin } from "../utils/request-host.ts";

// Re-export is at the bottom of the file
import type { HandlerContext as _HandlerContext } from "../handlers/types.ts";

// Handler imports
import { AuthHandler } from "#veryfront/security/http/auth.ts";
import { isPlatformLivenessProbe } from "#veryfront/security/http/platform-liveness-probe.ts";
import { CsrfHandler } from "#veryfront/security/http/csrf/csrf-handler.ts";
import { CorsHandler } from "../handlers/response/cors.ts";
import { HealthHandler } from "../handlers/monitoring/health.handler.ts";
import { MetricsHandler } from "../handlers/monitoring/metrics.handler.ts";
import {
  finalizeRequestProfiling,
  runWithRequestProfiling,
  updateRequestProfileContext,
  withServerTimingHeader,
} from "#veryfront/observability/request-profiler.ts";
import { profilePhase } from "#veryfront/observability";
import { captureApplicationError } from "#veryfront/observability/application-errors.ts";
import { ClientLogHandler } from "../handlers/monitoring/client-log.handler.ts";
import { MemoryDebugHandler } from "../handlers/monitoring/memory.handler.ts";
import { DevEndpointsHandler } from "../handlers/dev/endpoints.handler.ts";
import { DevFileHandler } from "../handlers/dev/files/index.ts";
import { DebugContextHandler } from "../handlers/dev/debug-context.handler.ts";
import { StylesCSSHandler } from "../handlers/dev/styles-css.handler.ts";
import { StudioBridgeModulesHandler } from "../handlers/studio/bridge-modules.handler.ts";
import { CspReportHandler } from "../handlers/request/csp-report.handler.ts";
import { StaticHandler } from "../handlers/request/static.handler.ts";
import { SnippetHandler } from "../handlers/request/snippet.handler.ts";
import { LibModulesHandler } from "../handlers/request/lib-modules.handler.ts";
import { ProdHydrationModuleHandler } from "../handlers/request/prod-hydration-module.handler.ts";
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
import { InternalAgentsListHandler } from "../handlers/request/internal-agents-list.handler.ts";
import { PublicAgentMetadataHandler } from "../handlers/request/public-agent-metadata.handler.ts";
import { PublicAgentsListHandler } from "../handlers/request/public-agents-list.handler.ts";
import { AgentStreamHandler } from "../handlers/request/agent-stream.handler.ts";
import { AgentRunResumeHandler } from "../handlers/request/agent-run-resume.handler.ts";
import { AgentRunCancelHandler } from "../handlers/request/agent-run-cancel.handler.ts";
import { ProjectRunExecuteHandler } from "../handlers/request/project-run-execute.handler.ts";
import { ChannelInvokeHandler } from "../handlers/request/channel-invoke.handler.ts";
import { DevDashboardHandler } from "../handlers/dev/dashboard/index.ts";
import { ProjectsHandler } from "../handlers/dev/projects/index.ts";
import { tryResolve } from "veryfront/extensions";
import {
  type DevUiAssetProvider,
  DevUiAssetProviderName,
  snapshotDevUiAssetProvider,
} from "#veryfront/extensions/dev-ui";

// Extracted modules
import {
  endRequestTracing,
  executeWithTracingContext,
  getRequestTraceContext,
  setProjectAttributes,
  setRequestAttributes,
  SpanNames,
  startRequestTracing,
  withSpan,
} from "./tracing.ts";
import {
  completeRequestTracking,
  completeRequestTrackingOnResponseEnd,
  endContentMetrics,
  endRequestLifecycle,
  incrementRequestMetrics,
  startContentMetrics,
  startRequestLifecycle,
  startRequestTracking,
  timeAsync,
} from "./request-lifecycle.ts";
import {
  checkRequestIsolation,
  completeIsolatedRequestOnSettlement,
  createIsolationErrorResponse,
  startIsolatedRequest,
} from "./isolation.ts";
import { defaultDiscoveryCache } from "./local-project-discovery.ts";
import { buildMinimalContext } from "./handler-context-builder.ts";
import { handleProjectsRequest, shouldHandleProjectsUI } from "./projects-handler.ts";
import {
  HTTP_GATEWAY_TIMEOUT,
  isHMRWebSocketUpgrade,
  isLightweightPath,
  isMonitoringPath,
} from "./request-utils.ts";
import { withRequestTimeout } from "./timeout-manager.ts";
import {
  EnvironmentVariableCache,
  fetchProjectEnvVars,
  filterRuntimeProjectEnv,
  runWithProjectEnv,
} from "../project-env/index.ts";
import { SCANNER_PATH_PATTERN } from "#veryfront/utils/constants/security.ts";
import { projectMiddlewareRuntime, runInProjectFilesystemContext } from "./project-middleware.ts";
import {
  prepareProjectRequest,
  resolveProjectIdentity,
  resolveProjectRuntimeContext,
} from "./project-runtime-context.ts";
import { runWithRetainedPreviewDocumentSourceSnapshot } from "#veryfront/server/handlers/request/source-snapshot-freshness.ts";

// Re-export from dedicated module for lightweight imports
export { parseProxyEnvironment, type ProxyEnvironment } from "./proxy-environment.ts";

const baseLogger = getBaseLogger("SERVER");

const logger = baseLogger.component("runtime-handler");

const SOURCE_SNAPSHOT_FRESHNESS_RETRY_LIMIT = 1;

function shouldRetrySourceSnapshotFreshness(
  request: Request,
  error: unknown,
  retries: number,
  projectMiddlewareStarted: boolean,
): boolean {
  return retries < SOURCE_SNAPSHOT_FRESHNESS_RETRY_LIMIT &&
    !projectMiddlewareStarted &&
    (request.method === "GET" || request.method === "HEAD") &&
    isVeryfrontError(error) &&
    error.slug === SOURCE_SNAPSHOT_FRESHNESS_UNAVAILABLE.slug;
}

function skipsApplicationAuth(
  request: Request,
  pathname: string,
  isFrameworkOwnedPreflight = false,
): boolean {
  return (request.method === "OPTIONS" && isFrameworkOwnedPreflight) ||
    isCspReportRequest(request.method, pathname) ||
    isSignedControlPlaneDispatch(request) ||
    isSignedChannelDispatch(request) ||
    isConfigOptionalControlPlaneRunRequest(request.method, pathname);
}

function applyApplicationAuthResult(
  authResult: ApplicationAuthHandlerResult | Response | null,
  ctx: _HandlerContext,
  isOptionsRequest: boolean,
  isBrowserPreflight: boolean,
): { response: Response | null; skipProjectMiddleware: boolean } {
  if (authResult instanceof Response) {
    if (!isBrowserPreflight) return { response: authResult, skipProjectMiddleware: false };
    ctx.applicationAuthResult = { response: authResult };
    return { response: null, skipProjectMiddleware: true };
  }

  if (isOptionsRequest) ctx.applicationAuthResult = authResult;
  ctx.applicationIdentity = authResult?.metadata?.applicationIdentity ?? null;
  ctx.applicationIdentityHeaderNames = authResult?.metadata?.applicationIdentityHeaderNames ?? [];
  return { response: null, skipProjectMiddleware: false };
}

/** Handler names in registration order. */
export const HANDLER_NAMES = [
  "AuthHandler",
  "CsrfHandler",
  "HMRHandler",
  "CorsHandler",
  "HealthHandler",
  "MetricsHandler",
  "MemoryDebugHandler",
  "ClientLogHandler",
  "DevEndpointsHandler",
  "StylesCSSHandler",
  "DebugContextHandler",
  "OpenAPIHandler",
  "OpenAPIDocsHandler",
  "InternalAgentsListHandler",
  "PublicAgentsListHandler",
  "PublicAgentMetadataHandler",
  "AgentStreamHandler",
  "AgentRunResumeHandler",
  "AgentRunCancelHandler",
  "ProjectRunExecuteHandler",
  "ChannelInvokeHandler",
  "DevDashboardHandler",
  "ProjectsHandler",
  "StudioBridgeModulesHandler",
  "ProdHydrationModuleHandler",
  "CSSHandler",
  "DevFileHandler",
  "SnippetHandler",
  "CspReportHandler",
  "StaticHandler",
  "LibModulesHandler",
  "RSCHandler",
  "ModuleHandler",
  "ApiHandlerWrapper",
  "MarkdownPreviewHandler",
  "SSRHandler",
  "NotFoundHandler",
] as const;

/** Union of all registered handler names. */
export type HandlerName = (typeof HANDLER_NAMES)[number];

/**
 * Dependencies for handler registry creation.
 * All fields are optional — when omitted, the real handler implementation is used.
 * This allows tests to inject mock handlers for specific slots.
 */
export interface HandlerDependencies {
  /** Override any handler by its typed name. */
  overrides?: Partial<Record<HandlerName, Handler>>;
  /** When true, log handler registration details. */
  debug?: boolean;
}

/**
 * Resolve the registered development UI asset provider, if an extension
 * provided one during bootstrap. Handlers degrade gracefully (fail closed)
 * when no provider is registered, e.g. in tests without extension setup.
 *
 * The snapshot is taken once at handler-registry construction and is not
 * refreshed across bootstrap regenerations; a provider registered by a later
 * extension generation is only picked up by a new registry.
 */
function resolveDevUiAssetProvider(): Readonly<DevUiAssetProvider> | undefined {
  const provider = tryResolve<unknown>(DevUiAssetProviderName);
  return provider === undefined ? undefined : snapshotDevUiAssetProvider(provider);
}

/** Factory for each handler. Only called when no override is provided (lazy instantiation). */
const handlerFactories: Record<
  HandlerName,
  (projectDir: string, adapter: RuntimeAdapter) => Handler
> = {
  AuthHandler: () => new AuthHandler(),
  CsrfHandler: () => new CsrfHandler(),
  HMRHandler: () => new HMRHandler(),
  CorsHandler: () => new CorsHandler(),
  HealthHandler: () => new HealthHandler(),
  MetricsHandler: () => new MetricsHandler(),
  MemoryDebugHandler: () => new MemoryDebugHandler(),
  ClientLogHandler: () => new ClientLogHandler(),
  DevEndpointsHandler: () => new DevEndpointsHandler(),
  StylesCSSHandler: () => new StylesCSSHandler(),
  DebugContextHandler: () => new DebugContextHandler(),
  OpenAPIHandler: () => new OpenAPIHandler(),
  OpenAPIDocsHandler: () => new OpenAPIDocsHandler(),
  InternalAgentsListHandler: () => new InternalAgentsListHandler(),
  PublicAgentsListHandler: () => new PublicAgentsListHandler(),
  PublicAgentMetadataHandler: () => new PublicAgentMetadataHandler(),
  AgentStreamHandler: () => new AgentStreamHandler(),
  AgentRunResumeHandler: () => new AgentRunResumeHandler(),
  AgentRunCancelHandler: () => new AgentRunCancelHandler(),
  ProjectRunExecuteHandler: () => new ProjectRunExecuteHandler(),
  ChannelInvokeHandler: () => new ChannelInvokeHandler(),
  DevDashboardHandler: () => new DevDashboardHandler(resolveDevUiAssetProvider()),
  ProjectsHandler: () => new ProjectsHandler(resolveDevUiAssetProvider()),
  StudioBridgeModulesHandler: () => new StudioBridgeModulesHandler(),
  ProdHydrationModuleHandler: () => new ProdHydrationModuleHandler(),
  CSSHandler: () => new CSSHandler(),
  DevFileHandler: () => new DevFileHandler(),
  SnippetHandler: () => new SnippetHandler(),
  CspReportHandler: () => new CspReportHandler(),
  StaticHandler: () => new StaticHandler(),
  LibModulesHandler: () => new LibModulesHandler(),
  RSCHandler: () => new RSCHandler(),
  ModuleHandler: () => new ModuleHandler(),
  ApiHandlerWrapper: (projectDir, adapter) => new ApiHandlerWrapper(projectDir, adapter),
  MarkdownPreviewHandler: () => new MarkdownPreviewHandler(),
  SSRHandler: () => new SSRHandler(),
  NotFoundHandler: () => new NotFoundHandler(),
};

/**
 * Creates a RouteRegistry populated with the standard handler chain.
 *
 * Handlers are instantiated lazily — overridden slots skip construction
 * of the default handler entirely.
 *
 * @param projectDir - Root project directory
 * @param adapter - Runtime adapter for environment access
 * @param deps - Optional dependency overrides for testing
 * @returns Object containing the registry and the api handler (for initialization)
 */
export function createHandlerRegistry(
  projectDir: string,
  adapter: RuntimeAdapter,
  deps: HandlerDependencies = {},
): { registry: RouteRegistry; apiHandler: ApiHandlerWrapper } {
  const registry = new RouteRegistry({
    debug: deps.debug,
    enableMetrics: true,
  });

  const overrides = deps.overrides ?? {};

  // Create the ApiHandlerWrapper first — it's special because callers need
  // the returned instance for initialization regardless of overrides.
  const apiHandler = overrides.ApiHandlerWrapper
    ? (overrides.ApiHandlerWrapper as ApiHandlerWrapper)
    : new ApiHandlerWrapper(projectDir, adapter);

  const handlers = HANDLER_NAMES.map((name) => {
    if (name === "ApiHandlerWrapper") return apiHandler;
    if (overrides[name]) return overrides[name]!;
    return handlerFactories[name](projectDir, adapter);
  });

  registry.registerAll(handlers);

  return { registry, apiHandler };
}

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
  /** Default release ID when not provided via proxy headers (for standalone production mode) */
  defaultReleaseId?: string;
  /** Default environment for standalone mode (preview or production). Defaults to preview for safety. */
  defaultEnvironment?: "preview" | "production";
  /** Host-owned capability for dedicated single-project runtime execution. */
  allowHostProjectCodeExecution?: boolean;
}

export function createVeryfrontHandler(
  projectDir: string,
  adapter: RuntimeAdapter,
  opts: RuntimeHandlerOptions = { projectDir },
): ((req: Request) => Promise<Response>) & { ready?: Promise<void> } {
  const handleApplicationAuthRequest = createApplicationAuthRequestHandler();
  const isDebugEnabled = (): boolean => {
    if (opts.debug) return true;

    const hostDebug = getHostEnv("VERYFRONT_DEBUG");
    if (hostDebug !== undefined) return isTruthyEnvValue(hostDebug);

    const hasBindingBackedEnv = adapter.id === "cloudflare" || adapter.id === "memory";
    return hasBindingBackedEnv && isTruthyEnvValue(adapter.env.get("VERYFRONT_DEBUG"));
  };

  function logDebug(message: string, extra?: Record<string, unknown>): void {
    if (!isDebugEnabled()) return;
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
      defaultDiscoveryCache.projects.set(slug, path);
    }
    logDebug("[runtime-handler] Seeded local project cache", {
      projects: Object.keys(opts.localProjects),
    });
  }

  const securityLoader = new SecurityConfigLoader(
    projectDir,
    adapter,
    opts.config,
    opts.defaultEnvironment === "production",
  );

  // Per-project environment variable cache (fetches from API, caches with 60s TTL)
  const apiBaseUrl = adapter.env.get("VERYFRONT_API_BASE_URL") ?? "https://api.veryfront.com/api";
  const envVarCache = new EnvironmentVariableCache(
    ({ environmentId, token, projectSlug }, signal) =>
      fetchProjectEnvVars(apiBaseUrl, projectSlug, environmentId, token, signal),
  );

  let config: VeryfrontConfig | undefined = opts.config;
  const configPromise = (async () => {
    const c = opts.config ? opts.config : await getConfig(projectDir, adapter);
    config = c;
    return c;
  })();

  const { registry, apiHandler } = createHandlerRegistry(projectDir, adapter, {
    debug: Boolean(opts.debug),
  });

  const isProxyMode = opts.config?.fs?.veryfront?.proxyMode === true;

  const readyPromise = isProxyMode ? Promise.resolve() : apiHandler.initialize().catch((error) => {
    logger.error("API handler initialization failed", {
      error: getErrorMessage(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  });

  if (isProxyMode) {
    logger.debug("Running in proxy mode - lazy initialization enabled");
  }

  const handler = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const lifecycle = startRequestLifecycle(req, url.pathname, isLightweightPath(url.pathname));

    // Fast path for monitoring endpoints
    if (isMonitoringPath(url.pathname)) {
      try {
        await readyPromise;
        if (!isProxyMode) await securityLoader.ensureLoaded();

        const requiresApplicationAuth = !isPlatformLivenessProbe(req.method, url.pathname) &&
          !skipsApplicationAuth(
            req,
            url.pathname,
            req.method.toUpperCase() === "OPTIONS" && isPreflightRequest(req),
          );
        let requestOrigin: string | null | undefined;
        if (requiresApplicationAuth) {
          const preparedMonitoringRequest = await prepareProjectRequest({
            req,
            url,
            isProxyMode,
          });
          const trustProxyHeaders = preparedMonitoringRequest.proxyTrust.proxyTrusted ??
            getHostEnv("VERYFRONT_TRUST_FORWARDED_HEADERS") === "1";
          requestOrigin = getEffectiveRequestOrigin(req, url, trustProxyHeaders);
        }

        const minimalCtx = buildMinimalContext(
          projectDir,
          adapter,
          securityLoader.getSecurityConfig(),
          isDebugEnabled(),
          config,
          requestOrigin,
        );

        if (requiresApplicationAuth) {
          const authResult = await handleApplicationAuthRequest(req, minimalCtx);
          if (authResult?.response) {
            const terminalResponse = authResult.response;
            const response = await applyCORSHeaders({
              request: req,
              response: terminalResponse,
              config: minimalCtx.securityConfig?.cors,
            });
            return response ?? terminalResponse;
          }
          minimalCtx.applicationIdentity = authResult?.metadata?.applicationIdentity ?? null;
          minimalCtx.applicationIdentityHeaderNames =
            authResult?.metadata?.applicationIdentityHeaderNames ?? [];
        }

        const response = await registry.execute(req, minimalCtx);
        return response ?? new Response("Not Found", { status: 404 });
      } finally {
        endRequestLifecycle(lifecycle);
      }
    }

    const preparedRequest = await prepareProjectRequest({
      req,
      url,
      isProxyMode,
    });
    const { headers, requestContext: reqCtx } = preparedRequest;
    const { proxyTrusted } = preparedRequest.proxyTrust;

    const loggerContext: RequestContext = {
      logger: logger.child({
        requestId: lifecycle.requestId,
        request_url: req.url,
        domain: preparedRequest.loggerFacts.domain,
        project_slug: preparedRequest.loggerFacts.projectSlug,
        project_id: preparedRequest.loggerFacts.projectId,
        release_id: preparedRequest.loggerFacts.releaseId,
        branch_id: preparedRequest.loggerFacts.branchId,
        branch_name: preparedRequest.loggerFacts.branchName,
        pathname: preparedRequest.loggerFacts.pathname,
      }),
      requestId: lifecycle.requestId,
      projectSlug: preparedRequest.loggerFacts.projectSlug,
      projectId: preparedRequest.loggerFacts.projectId,
      domain: preparedRequest.loggerFacts.domain,
    };

    return runWithRequestContextAsync(loggerContext, async () => {
      const spanInfo = startRequestTracing(req, url.pathname);
      setRequestAttributes(spanInfo.span, req, url);

      // Reject untrusted/malformed proxy identity before any project-keyed
      // accounting is touched. In particular, isolation creates per-slug
      // state on first access; admitting attacker-controlled slugs there would
      // let rejected requests grow shared-process state indefinitely.
      if (preparedRequest.proxyGuard) {
        try {
          logger.warn(preparedRequest.proxyGuard.detail, {
            pathname: url.pathname,
            domain: preparedRequest.loggerFacts.domain,
            projectSlug: headers.projectSlug,
            host: req.headers.get("host"),
            forwardedHost: req.headers.get("x-forwarded-host"),
          });
          endRequestTracing(spanInfo.span, preparedRequest.proxyGuard.response.status);
          return preparedRequest.proxyGuard.response;
        } finally {
          endRequestLifecycle(lifecycle);
        }
      }

      startRequestTracking(
        lifecycle.requestId,
        preparedRequest.trackingFacts.projectSlug,
        preparedRequest.trackingFacts.pathname,
        preparedRequest.trackingFacts.method,
        preparedRequest.trackingFacts.environment,
        preparedRequest.trackingFacts.releaseId,
        opts.defaultEnvironment === "production",
      );

      startContentMetrics();

      // Check isolation
      const isolationCheck = checkRequestIsolation(
        headers.projectSlug,
        lifecycle.shouldCheckIsolation,
      );

      if (!isolationCheck.allowed) {
        endContentMetrics({
          requestId: lifecycle.requestId,
          pathname: url.pathname,
          mode: "isolation",
        });
        completeRequestTracking(lifecycle.requestId, 503, false);
        const response = createIsolationErrorResponse(isolationCheck);
        endRequestTracing(spanInfo.span, response.status);
        return response;
      }

      startIsolatedRequest(headers.projectSlug, lifecycle.shouldCheckIsolation);

      try {
        const profileCategory = url.pathname.startsWith("/_vf_styles/")
          ? "css"
          : url.pathname.startsWith("/_vf_modules/")
          ? "module"
          : url.pathname.startsWith("/api/")
          ? "api"
          : "html";
        let requestProfileRecord: ReturnType<typeof finalizeRequestProfiling> = null;

        let requestMetricsIncremented = false;
        let projectMiddlewareStarted = false;
        const markProjectMiddlewareStarted = () => {
          projectMiddlewareStarted = true;
        };
        const executeHandlerAttempt = async (request: Request): Promise<Response> => {
          // Fast rejection of vulnerability scanner probes before any async work
          if (SCANNER_PATH_PATTERN.test(url.pathname)) {
            return new Response("Not Found", { status: 404 });
          }

          await profilePhase("runtime.ready", () => readyPromise);

          await timeAsync("security:load", () =>
            profilePhase("runtime.security_load", async () => {
              if (isProxyMode) return;
              await securityLoader.ensureLoaded();
            }));

          await timeAsync("config:load", () =>
            profilePhase("runtime.config_load", async () => {
              await configPromise;
            }));

          // Browser-controlled WebSocket query parameters cannot select tenant
          // identity. Local development uses the configured default project;
          // hosted requests use the edge-derived header or routed host.
          const wsSlugOverride = undefined;

          // Resolve project from various sources
          const projectRes = await profilePhase(
            "runtime.resolve_project",
            () =>
              resolveProjectIdentity({
                req: request,
                url,
                headers,
                config,
                requestContext: reqCtx,
                defaultProjectSlug: opts.defaultProjectSlug,
                defaultProjectId: opts.defaultProjectId,
                defaultReleaseId: opts.defaultReleaseId,
                wsSlugOverride,
                proxyTrust: { proxyTrusted },
              }),
          );
          updateRequestProfileContext({ projectSlug: projectRes.projectSlug });

          setProjectAttributes(spanInfo.span, projectRes.projectSlug, projectRes.proxyEnv);

          // Handle projects discovery UI
          if (
            shouldHandleProjectsUI(
              request,
              url.pathname,
              projectRes.projectSlug,
              projectRes.parsedDomain,
            )
          ) {
            const response = await handleProjectsRequest(
              request,
              url,
              buildMinimalContext(
                projectDir,
                adapter,
                securityLoader.getSecurityConfig(),
                isDebugEnabled(),
                config,
              ),
            );
            if (response) return response;
          }

          const runtimeContext = await resolveProjectRuntimeContext({
            req: request,
            url,
            projectDir,
            adapter,
            config,
            projectIdentity: projectRes,
            headers,
            requestContext: reqCtx,
            isProxyMode,
            allowHostProjectCodeExecution: opts.allowHostProjectCodeExecution,
            proxyTrust: { proxyTrusted },
            securityConfig: securityLoader.getSecurityConfig(),
            debug: isDebugEnabled(),
            routeRegistry: registry,
            moduleServerUrl: opts.moduleServerUrl,
            defaultEnvironment: opts.defaultEnvironment,
            envVarCache,
            profileAdapter: (operation) => profilePhase("runtime.resolve_adapter", operation),
            profileEnvVars: (operation) => profilePhase("runtime.load_env_vars", operation),
            onEnvironmentResolved: (envRes) => {
              updateRequestProfileContext({ requestMode: envRes.resolvedEnvironment });
            },
            logDebug,
          });
          const adapterRes = runtimeContext.adapter;
          const envRes = runtimeContext.environment;

          if (envRes.errorResponse) {
            return envRes.errorResponse;
          }

          const ctx = runtimeContext.handlerContext!;
          const envVarsForRequest = runtimeContext.rawEnvVars;
          // Only activate env isolation in proxy mode (multi-tenant).
          // reqCtx.token indicates the request came through the proxy with auth.
          // Without it (standalone / test), host env must remain accessible.
          const shouldIsolateEnv = !adapterRes.isLocalProject && !!reqCtx.token;
          const isolatedEnvForRequest = shouldIsolateEnv
            ? filterRuntimeProjectEnv(envVarsForRequest)
            : undefined;
          const runInRequestProjectEnv = <T>(operation: () => T): T =>
            isolatedEnvForRequest === undefined
              ? operation()
              : runWithProjectEnv(isolatedEnvForRequest, operation);

          if (!requestMetricsIncremented) {
            await incrementRequestMetrics();
            requestMetricsIncremented = true;
          }

          const isFrameworkOwnedPreflight = await apiHandler.isFrameworkOwnedPreflight(
            request,
            ctx,
          );
          const isOptionsRequest = request.method.toUpperCase() === "OPTIONS";
          const isBrowserPreflight = isOptionsRequest && isPreflightRequest(request);
          let skipProjectMiddleware = false;
          if (!skipsApplicationAuth(request, url.pathname, isFrameworkOwnedPreflight)) {
            const runInFilesystemContext = <T>(operation: () => Promise<T>) =>
              runInProjectFilesystemContext(ctx, isProxyMode, operation);
            const authResult = await runInFilesystemContext(
              () =>
                runWithRetainedPreviewDocumentSourceSnapshot(
                  ctx,
                  async () => {
                    const result = await runInRequestProjectEnv(() =>
                      handleApplicationAuthRequest(request, ctx)
                    );
                    if (result?.response) {
                      const terminalResponse = result.response;
                      const response = await runInRequestProjectEnv(() =>
                        applyCORSHeaders({
                          request,
                          response: terminalResponse,
                          config: ctx.securityConfig?.cors,
                        })
                      );
                      return response ?? terminalResponse;
                    }
                    return result;
                  },
                  {
                    retainAfterOperation: (result) => !(result instanceof Response),
                    runDeferredOperation: runInFilesystemContext,
                  },
                ),
            );
            const authOutcome = applyApplicationAuthResult(
              authResult,
              ctx,
              isOptionsRequest,
              isBrowserPreflight,
            );
            if (authOutcome.response) return authOutcome.response;
            skipProjectMiddleware = authOutcome.skipProjectMiddleware;
          }

          const sourceIntegrationPolicy = runtimeContext.sourceIntegrationPolicy;
          const executeProjectRoute = () =>
            projectMiddlewareRuntime.execute({
              request,
              handlerContext: ctx,
              isSharedProxy: isProxyMode,
              isFrameworkOwnedPreflight,
              skipProjectMiddleware,
              next: async () => (await registry.execute(request, ctx)) ?? undefined,
              onMiddlewareStart: markProjectMiddlewareStarted,
            });
          const executeRoute = () =>
            runWithExactSourceIntegrationPolicy(
              sourceIntegrationPolicy,
              executeProjectRoute,
            );
          const response = await withSpan(
            SpanNames.HANDLER_EXECUTE,
            () =>
              profilePhase("handler.execute", () => {
                return runInRequestProjectEnv(executeRoute);
              }),
            {
              "handler.project_slug": projectRes.projectSlug || "unknown",
              "handler.path": url.pathname,
              "handler.method": request.method,
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
          return errorToRFC9457Response(noHandlerError, ctx, request);
        };

        const executeHandler = async (request: Request): Promise<Response> => {
          let retries = 0;
          while (true) {
            try {
              return await executeHandlerAttempt(request);
            } catch (error) {
              if (
                !shouldRetrySourceSnapshotFreshness(
                  request,
                  error,
                  retries,
                  projectMiddlewareStarted,
                )
              ) throw error;
              retries++;
              // Info, not debug: a retried request is indistinguishable from a
              // first-attempt success in the response, so this line is the only
              // way to confirm in staging that the retry is carrying the load.
              logger.info("Retrying request after source snapshot freshness failure", {
                pathname: url.pathname,
                method: request.method,
                retry: retries,
              });
            }
          }
        };

        const { response, error, settled } = await withRequestTimeout(
          (signal) => {
            // Deno.upgradeWebSocket requires the exact Request received by
            // Deno.serve. Cloning it to attach the timeout signal lets the
            // handshake return 101, but the upgraded connection immediately
            // closes with an unexpected EOF.
            const timeoutRequest = isHMRWebSocketUpgrade(req, url.pathname)
              ? req
              : inheritRequestPeerProvenance(req, new Request(req, { signal }));
            return runWithRequestProfiling(
              {
                category: profileCategory,
                method: req.method,
                pathname: url.pathname,
                projectSlug: headers.projectSlug,
                requestMode: headers.environment,
              },
              async () => {
                let profiledResponse: Response | undefined;
                try {
                  profiledResponse = await executeWithTracingContext(
                    spanInfo,
                    () => executeHandler(timeoutRequest),
                  );
                  return profiledResponse;
                } finally {
                  requestProfileRecord = finalizeRequestProfiling(profiledResponse?.status);
                }
              },
            );
          },
          url.pathname,
          req.method,
          { signal: req.signal },
        );

        if (error) {
          captureApplicationError(error, {
            boundary: "renderer.request",
            method: req.method,
            requestId: lifecycle.requestId,
            ...getRequestTraceContext(spanInfo.span),
          });
        }

        endRequestTracing(spanInfo.span, response.status, error);

        endContentMetrics({
          requestId: lifecycle.requestId,
          pathname: url.pathname,
          mode: headers.environment || "unknown",
        });

        const isTimeout = response.status === HTTP_GATEWAY_TIMEOUT;

        completeIsolatedRequestOnSettlement(
          headers.projectSlug,
          lifecycle.shouldCheckIsolation,
          isTimeout,
          settled,
        );

        return completeRequestTrackingOnResponseEnd(
          lifecycle.requestId,
          withServerTimingHeader(response, requestProfileRecord),
          isTimeout,
          requestProfileRecord,
          settled,
        );
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
