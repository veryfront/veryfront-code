/**
 * Veryfront Proxy Server (Split Mode)
 *
 * Standalone proxy server that forwards requests to a separate production server process.
 * Used in production for security isolation of OAuth credentials.
 *
 * For combined mode (single process), use the production server with --proxy flag instead.
 *
 * Environment Variables:
 * - VERYFRONT_PROXY_API_CLIENT_ID: OAuth client ID
 * - VERYFRONT_PROXY_API_CLIENT_SECRET: OAuth client secret
 * - VERYFRONT_PROXY_API_BASE_URL: Veryfront API base URL
 * - VERYFRONT_SERVER_URL: URL of the production server service
 * - VERYFRONT_PROXY_URL: Optional proxy bind URL (e.g. http://0.0.0.0:8080)
 * - LOCAL_PROJECTS: JSON map of slug → filesystem path (for dev)
 * - CACHE_TYPE: "memory" (default) or "redis"
 * - REDIS_URL: Redis connection URL (required if CACHE_TYPE=redis)
 * - REDIS_PREFIX: Optional Redis token-key namespace
 * - REDIS_PASSWORD: Optional Redis password when it is not embedded in REDIS_URL
 * - VERYFRONT_PROXY_EXPECTED_REPLICAS: Minimum proxy replicas required to acknowledge routing changes
 * - VERYFRONT_PROXY_ROUTING_INVALIDATION_SECRET: HMAC secret for Redis routing events and acknowledgements
 * - VERYFRONT_API_INTERNAL_URL: API URL for internal endpoints (falls back to VERYFRONT_PROXY_API_BASE_URL)
 * - VERYFRONT_API_INTERNAL_USER: Basic auth user for internal API
 * - VERYFRONT_API_INTERNAL_PASS: Basic auth pass for internal API
 * - VERYFRONT_API_REQUEST_TIMEOUT_MS: Deadline for BFF API requests
 * - VERYFRONT_PROXY_MAX_WEBSOCKET_BRIDGES: Per-replica live WebSocket bridge limit
 * - SHUTDOWN_DRAIN_TIMEOUT_MS: Time to wait for active SSE responses during shutdown
 * - SHUTDOWN_CLEANUP_TIMEOUT_MS: Total cleanup budget after request draining
 */

import { createProxyContextHeaders, createProxyHandler } from "./handler.ts";
import {
  getReplayableRequestBodies,
  getUpstreamRetryCount,
  shouldRetryUpstreamRequest,
} from "./retry.ts";
import {
  authorizeWebSocketRequest,
  createProxyClientWebSocketUpgradeOptions,
  createProxyWebSocketBridge,
  createProxyWebSocketTargetUrl,
  isProxyWebSocketUpgrade,
  PROXY_WEBSOCKET_CONNECTION_TIMEOUT_MS,
  ProxyWebSocketBridgeRegistry,
} from "./websocket-bridge.ts";
import { register, tryResolve, unregister } from "../extensions/contracts.ts";
import { importFirstPartyExtensionModule } from "#veryfront/extensions/first-party-import.ts";
import { ensureError, getErrorMessage, INITIALIZATION_ERROR } from "#veryfront/errors";
import { awaitAbortable } from "#veryfront/utils/abort.ts";
import { sanitizeUrlForSpan } from "#veryfront/utils/logger/redact.ts";
import {
  endSpan,
  extractContext,
  getTraceContext,
  initializeOTLPWithApis,
  injectContext,
  ProxySpanNames,
  shutdownOTLP,
  startServerSpan,
  withContext,
  withSpan,
} from "./tracing.ts";
import { proxyLogger, runWithProxyRequestContext } from "./logger.ts";
import { getProxyFailureLogLevel } from "./log-noise.ts";
import { createRendererRouterFromEnvironment } from "./renderer-router.ts";
import { ServerResolver } from "./server-resolver.ts";
import { exit, onSignal } from "#veryfront/platform/compat/process.ts";
import { createHttpServer, upgradeWebSocket } from "#veryfront/platform/compat/http/index.ts";
import { createProxyErrorResponse, jsonErrorResponse } from "./error-response.ts";
import { handleReleaseAssetRequest, isReleaseAssetPath } from "./asset-handler.ts";
import { type ProxyRequestLifecycle, runProxyRequestLifecycle } from "./request-lifecycle.ts";
import {
  createUpstreamFailureResponse,
  createUpstreamTimeoutResponse,
  UPSTREAM_FAILURE_STATUS,
  UPSTREAM_TIMEOUT_STATUS,
} from "./upstream-error-response.ts";
import {
  createProxyServerTiming,
  markProxyServerTimingPhase,
  profileProxyServerTimingPhase,
  withProxyServerTimingHeader,
} from "./server-timing.ts";
import { removeStickyCookieFromPublicCacheableResponse } from "./response-headers.ts";
import {
  closeProxyServerWithin,
  createProxyDrainingResponse,
  ProxyRequestDrainTracker,
} from "./request-drain.ts";
import {
  handleProxyRoutingInvalidationRequest,
  PROXY_ROUTING_INVALIDATION_PATH,
} from "./routing-invalidation.ts";
import { startProxyRoutingInvalidationBus } from "./routing-invalidation-redis.ts";
import { readProxyStartupConfig } from "./startup-config.ts";
import { createProxyAuthProvider } from "./auth-extension.ts";
import { runProxyShutdownSteps } from "./shutdown.ts";
import { createProxyStartupRollback } from "./startup-rollback.ts";
import {
  acquireProxySignalHandlers,
  createProxyStartupSignalRouter,
  type ProxySignalHandlers,
  ProxyStartupSignalError,
} from "./startup-signals.ts";
import { acquireProxyStartupCache } from "./startup-cache.ts";
import { startProxyListener } from "./listener-startup.ts";
import {
  createProxyShutdownCoordinator,
  type ProxyShutdownCoordinator,
  type ProxyShutdownRequest,
  type ProxyShutdownState,
} from "./shutdown-coordinator.ts";
import {
  API_PROXY_PATH_PREFIX,
  createApiTargetUrl,
  createRendererTargetUrl,
  fetchWithProxyDeadline,
  ProxyOutboundRequestTimeoutError,
  waitForProxyDelay,
} from "./outbound-request.ts";
import { cancelProxyResponseBody } from "./response-body.ts";
import { ProxyRequestHostError } from "./request-host.ts";
import { createProxyEndToEndHeaders } from "./hop-by-hop-headers.ts";
import {
  type ApplicationErrorReporterInitializer,
  ApplicationErrorReporterInitializerName,
  captureApplicationError,
  flushApplicationErrors,
  initializeApplicationErrorReporter,
} from "#veryfront/observability/application-errors.ts";

const startupConfig = readProxyStartupConfig();
const config = startupConfig.proxyConfig;
const PRODUCTION_SERVER_URL = startupConfig.productionServerUrl;

const { hostname: HOST, port: PORT } = startupConfig.binding;
const PROXY_SERVER_CLOSE_TIMEOUT_MS = 1_000;
const VERYFRONT_API_REQUEST_TIMEOUT_MS = startupConfig.apiRequestTimeoutMs;
const VERYFRONT_SERVER_REQUEST_TIMEOUT_MS = startupConfig.serverRequestTimeoutMs;
const VERYFRONT_SERVER_RETRY_COUNT = startupConfig.serverRetryCount;
const VERYFRONT_SERVER_RETRY_DELAY_MS = startupConfig.serverRetryDelayMs;
const SHUTDOWN_DRAIN_TIMEOUT_MS = startupConfig.shutdownDrainTimeoutMs;
const SHUTDOWN_CLEANUP_TIMEOUT_MS = startupConfig.shutdownCleanupTimeoutMs;
const routingInvalidationSecret = startupConfig.routingInvalidationSecret;
let startupRollbackFailed = false;
const startupRollback = createProxyStartupRollback({
  cleanupTimeoutMs: SHUTDOWN_CLEANUP_TIMEOUT_MS,
  reportStartupFailure: (error) => {
    if (error instanceof ProxyStartupSignalError) return;
    captureApplicationError(error, { boundary: "process.startup" });
  },
  reportCleanupFailure: (failure) => {
    startupRollbackFailed = true;
    if (failure.status === "timeout") {
      proxyLogger.error("Proxy startup rollback step timed out", {
        step: failure.step,
        cleanupTimeoutMs: SHUTDOWN_CLEANUP_TIMEOUT_MS,
      });
      return;
    }
    proxyLogger.error(
      "Proxy startup rollback step failed",
      { step: failure.step },
      failure.error,
    );
  },
});

let shutdownCoordinator: ProxyShutdownCoordinator | null = null;
const startupSignalRouter = createProxyStartupSignalRouter((signal) => {
  const coordinator = shutdownCoordinator;
  if (!coordinator) {
    throw new Error("Proxy runtime signal arrived before shutdown coordination was ready");
  }
  void coordinator.request({ source: "signal", signal });
});

function finishProxyStartupFailure(error: unknown): never {
  if (error instanceof ProxyStartupSignalError) {
    proxyLogger.info(`Received ${error.signal}, proxy startup rollback finished`, {
      source: "signal",
      failed: startupRollbackFailed,
    });
    exit(startupRollbackFailed ? 1 : 0);
  }
  throw error;
}

async function awaitProxyStartupOperation<T>(operation: Promise<T>): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    return finishProxyStartupFailure(error);
  }
}

function runProxyStartupStage<T>(
  stage: () => T | PromiseLike<T>,
): Promise<T> {
  return awaitProxyStartupOperation(
    startupRollback.run(stage, startupSignalRouter.startupSignal),
  );
}

async function acquireProxyStartupResource<T>(
  name: string,
  stage: () => T | PromiseLike<T>,
  cleanup: (resource: T) => void | Promise<void>,
): Promise<T> {
  const acquisition = await awaitProxyStartupOperation(
    startupRollback.acquire(
      name,
      stage,
      cleanup,
      startupSignalRouter.startupSignal,
    ),
  );
  return acquisition.value;
}

let signalHandlers: ProxySignalHandlers | null = null;
signalHandlers = await runProxyStartupStage(() =>
  acquireProxySignalHandlers({
    startupRollback,
    registerSignal: onSignal,
    handleSignal: startupSignalRouter.handle,
  })
);

// Signal handlers are the earliest startup resource and therefore the final
// rollback cleanup. Reporter selection belongs to application composition;
// absence is an explicit disabled state.
const applicationErrorReporter = await runProxyStartupStage(() =>
  initializeApplicationErrorReporter({
    initializer: tryResolve<ApplicationErrorReporterInitializer>(
      ApplicationErrorReporterInitializerName,
    ),
    serviceName: "veryfront-proxy",
  })
);
startupRollback.own(
  "application-error-reporter",
  () => applicationErrorReporter.dispose(),
);
startupRollback.own("application-errors", async () => {
  await flushApplicationErrors();
});

const rendererRouter = await acquireProxyStartupResource(
  "renderer-router",
  () => createRendererRouterFromEnvironment(PRODUCTION_SERVER_URL),
  (router) => router?.close(),
);

// Dedicated server resolver: routes environments to their dedicated server if assigned
const serverResolver = await acquireProxyStartupResource(
  "server-resolver",
  () =>
    new ServerResolver(
      startupConfig.apiInternalUrl,
      startupConfig.apiInternalUser,
      startupConfig.apiInternalPass,
    ),
  (resolver) => resolver.close(),
);

const proxyRequestDrainTracker = new ProxyRequestDrainTracker();
const proxyWebSocketBridgeRegistry = await acquireProxyStartupResource(
  "websocket-bridges",
  () =>
    new ProxyWebSocketBridgeRegistry(
      startupConfig.maxActiveWebSocketBridges,
    ),
  (registry) => registry.close(),
);
let shuttingDown = false;

const previousAuthProvider = tryResolve<unknown>("AuthProvider");
const authProvider = await runProxyStartupStage(() =>
  importFirstPartyExtensionModule<unknown>(
    "ext-auth-jwt",
    "@veryfront/ext-auth-jwt",
  ).then(createProxyAuthProvider).catch((error) => {
    throw INITIALIZATION_ERROR.create({
      detail: "The Veryfront proxy requires a valid ext-auth-jwt extension. " +
        "In npm deployments install @veryfront/ext-auth-jwt alongside veryfront.",
      cause: error,
    });
  })
);
await acquireProxyStartupResource(
  "auth-provider-registration",
  () => {
    register("AuthProvider", authProvider);
    return authProvider;
  },
  (registeredProvider) => {
    if (tryResolve<unknown>("AuthProvider") !== registeredProvider) return;
    if (previousAuthProvider === undefined) unregister("AuthProvider");
    else register("AuthProvider", previousAuthProvider);
  },
);

// Initialize cache and proxy handler. Registry restoration intentionally
// remains owned by startup until listener readiness commits the transaction.
const startupCache = await awaitProxyStartupOperation(
  acquireProxyStartupCache(
    startupRollback,
    {},
    startupSignalRouter.startupSignal,
  ),
);
const cache = startupCache.cache;
const routingInvalidationLogger = {
  debug: (msg: string, extra?: Record<string, unknown>) => proxyLogger.debug(msg, extra),
  info: (msg: string, extra?: Record<string, unknown>) => proxyLogger.info(msg, extra),
  warn: (msg: string, extra?: Record<string, unknown>) => proxyLogger.warn(msg, extra),
  error: (msg: string, error?: unknown, extra?: Record<string, unknown>) =>
    proxyLogger.error(msg, extra ?? {}, error),
};
const proxyHandler = await acquireProxyStartupResource(
  "proxy-handler",
  () =>
    createProxyHandler({
      config,
      cache,
      logger: routingInvalidationLogger,
    }),
  async (handler) => {
    await handler.close();
    startupCache.transferToHandler();
  },
);
const routingInvalidationBus = await acquireProxyStartupResource(
  "routing-invalidation-bus",
  () =>
    startProxyRoutingInvalidationBus({
      expectedReplicas: startupConfig.expectedReplicas,
      integritySecret: routingInvalidationSecret,
      logger: routingInvalidationLogger,
      onInvalidate: proxyHandler.invalidateAndConfirmRoutingLookup,
    }).catch((error) => {
      if (startupConfig.production) {
        throw new Error("Proxy routing invalidation bus failed to start", { cause: error });
      }
      proxyLogger.error(
        "Proxy routing invalidation bus failed; TTL recovery remains active",
        {},
        error,
      );
      return null;
    }),
  (bus) => bus?.close(),
);
if (startupConfig.production && !routingInvalidationBus) {
  await runProxyStartupStage(() => {
    throw new Error(
      "Proxy routing invalidation bus requires REDIS_URL and a valid VERYFRONT_PROXY_ROUTING_INVALIDATION_SECRET in production",
    );
  });
}

// Validate configuration on startup
const missingCredentials = await runProxyStartupStage(() => proxyHandler.validateConfig());
if (missingCredentials.length > 0) {
  proxyLogger.warn("Missing OAuth credentials", { missingCredentials });
  proxyLogger.warn("Proxy will forward requests without authentication");
}

// Log local projects if configured
if (Object.keys(proxyHandler.localProjects).length > 0) {
  proxyLogger.info("Local projects configured", {
    projects: Object.keys(proxyHandler.localProjects),
  });
}

/**
 * Handle WebSocket upgrade requests.
 * Bridges browser WebSocket to server HMR WebSocket endpoint.
 */
async function handleWebSocketUpgrade(req: Request, url: URL): Promise<Response> {
  const authorization = await authorizeWebSocketRequest(
    req,
    url,
    proxyHandler.processRequest,
  );
  if (!authorization.allowed) return createProxyErrorResponse(authorization.error);

  const { context } = authorization;
  const host = context.host;
  const scope = context.environment;
  const projectSlug = context.projectSlug;

  const targetUrl = createProxyWebSocketTargetUrl(
    PRODUCTION_SERVER_URL,
    url,
    projectSlug || "",
    scope,
  );

  proxyLogger.info("[WebSocket] Upgrade request received", {
    host,
    path: url.pathname,
    projectSlug,
    environment: scope,
    parsedEnvironment: context.parsedDomain.environment,
  });

  const { socket: clientSocket, response } = upgradeWebSocket(
    req,
    createProxyClientWebSocketUpgradeOptions(),
  );

  const bridge = createProxyWebSocketBridge({
    clientSocket,
    connectTimeoutMs: PROXY_WEBSOCKET_CONNECTION_TIMEOUT_MS,
    createServerSocket: (serverTargetUrl) => new WebSocket(serverTargetUrl),
    logger: proxyLogger.child({
      environment: scope,
      projectSlug,
    }),
    targetUrl,
  });
  proxyWebSocketBridgeRegistry.track(bridge);

  return response;
}

function forwardToServer(req: Request, url: URL): Promise<Response> {
  const startTime = performance.now();
  const proxyTiming = createProxyServerTiming();
  const withProxyTiming = (response: Response): Response =>
    withProxyServerTimingHeader(response, proxyTiming, performance.now() - startTime);
  const requestId = crypto.randomUUID();

  const execute = async (lifecycle: ProxyRequestLifecycle): Promise<Response> => {
    try {
      const ctx = await profileProxyServerTimingPhase(
        proxyTiming,
        "proxy.resolve_request",
        () => proxyHandler.processRequest(req, { url, timing: proxyTiming }),
      );

      return runWithProxyRequestContext(
        {
          requestId,
          projectSlug: ctx.projectSlug,
          projectId: ctx.projectId,
          releaseId: ctx.releaseId,
          branchId: ctx.branchId,
          branchName: ctx.branchName,
          domain: ctx.host,
          environment: ctx.environment,
        },
        async () => {
          if (ctx.error) {
            const ms = Math.round(performance.now() - startTime);
            const logLevel = getProxyFailureLogLevel(ctx.error.status, req.method, url.pathname);
            proxyLogger[logLevel](`${ctx.error.status} ${req.method} ${url.pathname}`, { ms });
            lifecycle.end(ctx.error.status);
            return withProxyTiming(createProxyErrorResponse(ctx.error));
          }

          const reqLogger = proxyLogger.child({
            ...(ctx.projectSlug && { project: ctx.projectSlug }),
            env: ctx.environment,
          });

          const newHeaders = createProxyContextHeaders(req.headers, ctx);

          injectContext(newHeaders);

          const maxRetries = getUpstreamRetryCount(
            req,
            url.pathname,
            VERYFRONT_SERVER_RETRY_COUNT,
          );
          const upstreamBodies = getReplayableRequestBodies(req, maxRetries);
          let lastError: unknown;
          // After a retryable connection error to a dedicated server, fall back to shared pool
          let skipDedicated = false;

          for (let attempt = 0; attempt <= maxRetries; attempt++) {
            // Resolve dedicated server per attempt so retries can fall back to shared pool
            const dedicatedServerUrl = skipDedicated ? null : await awaitAbortable(
              profileProxyServerTimingPhase(
                proxyTiming,
                "proxy.resolve_server",
                () => serverResolver.resolve(ctx.environmentId),
              ),
              req.signal,
            );
            const baseUrl = dedicatedServerUrl ??
              rendererRouter?.resolve(ctx.projectSlug) ??
              PRODUCTION_SERVER_URL;
            const serverUrl = createRendererTargetUrl(baseUrl, url);
            // Delay before retry (not on first attempt)
            if (attempt > 0) {
              proxyLogger.info(
                `[Retry] Attempt ${attempt + 1}/${
                  maxRetries + 1
                } after ${VERYFRONT_SERVER_RETRY_DELAY_MS}ms`,
                {
                  pathname: url.pathname,
                  method: req.method,
                },
              );
              const retryDelayStartedAt = performance.now();
              await waitForProxyDelay(VERYFRONT_SERVER_RETRY_DELAY_MS, req.signal);
              markProxyServerTimingPhase(
                proxyTiming,
                "proxy.retry_delay",
                performance.now() - retryDelayStartedAt,
              );
            }

            try {
              const response = await profileProxyServerTimingPhase(
                proxyTiming,
                "proxy.upstream",
                () =>
                  withSpan(
                    ProxySpanNames.HTTP_CLIENT_FETCH,
                    () =>
                      fetchWithProxyDeadline(serverUrl, {
                        timeoutMs: VERYFRONT_SERVER_REQUEST_TIMEOUT_MS,
                        signal: req.signal,
                        init: {
                          method: req.method,
                          headers: newHeaders,
                          body: upstreamBodies[attempt] ?? null,
                          redirect: "manual",
                        },
                      }),
                    {
                      "http.method": req.method,
                      "http.url": sanitizeUrlForSpan(serverUrl.toString()),
                      "http.host": serverUrl.host,
                      "proxy.target": "server",
                      "proxy.project_slug": ctx.projectSlug || "",
                      "proxy.timeout_ms": VERYFRONT_SERVER_REQUEST_TIMEOUT_MS,
                      "proxy.retry_attempt": attempt,
                    },
                  ),
              );

              const ms = Math.round(performance.now() - startTime);

              if (attempt > 0) {
                reqLogger.info(
                  `${response.status} ${req.method} ${url.pathname} (retry succeeded)`,
                  { ms, attempt },
                );
              } else {
                reqLogger.info(`${response.status} ${req.method} ${url.pathname}`, { ms });
              }

              return withProxyTiming(
                removeStickyCookieFromPublicCacheableResponse(
                  new Response(response.body, {
                    status: response.status,
                    statusText: response.statusText,
                    headers: createProxyEndToEndHeaders(response.headers),
                  }),
                ),
              );
            } catch (error) {
              lastError = error;

              if (req.signal.aborted) throw ensureError(error);

              if (error instanceof ProxyOutboundRequestTimeoutError) {
                const ms = Math.round(performance.now() - startTime);
                proxyLogger.error(`${UPSTREAM_TIMEOUT_STATUS} ${req.method} ${url.pathname}`, {
                  ms,
                  timeoutMs: VERYFRONT_SERVER_REQUEST_TIMEOUT_MS,
                });
                lifecycle.end(UPSTREAM_TIMEOUT_STATUS, error);
                return withProxyTiming(
                  createUpstreamTimeoutResponse(VERYFRONT_SERVER_REQUEST_TIMEOUT_MS),
                );
              }

              // Check if this is a retryable error and we have retries left
              if (
                shouldRetryUpstreamRequest(req, url.pathname, error) &&
                attempt < maxRetries
              ) {
                // If we were targeting a dedicated server, fall back to shared pool on retry
                if (dedicatedServerUrl) {
                  skipDedicated = true;
                  proxyLogger.warn(
                    `[Retry] Dedicated server unreachable, falling back to shared pool`,
                    {
                      pathname: url.pathname,
                      dedicatedServerUrl,
                      error: getErrorMessage(error),
                    },
                  );
                } else {
                  proxyLogger.warn(
                    `[Retry] Retryable connection error on attempt ${attempt + 1}`,
                    {
                      pathname: url.pathname,
                      error: getErrorMessage(error),
                    },
                  );
                }
                continue; // Try again
              }

              // No more retries or non-retryable error
              break;
            }
          }

          // All retries exhausted or non-retryable error
          const ms = Math.round(performance.now() - startTime);
          const normalizedLastError = ensureError(lastError);
          const logLevel = getProxyFailureLogLevel(
            UPSTREAM_FAILURE_STATUS,
            req.method,
            url.pathname,
          );
          proxyLogger[logLevel](
            `${UPSTREAM_FAILURE_STATUS} ${req.method} ${url.pathname}`,
            { ms },
            normalizedLastError,
          );
          lifecycle.end(UPSTREAM_FAILURE_STATUS, normalizedLastError);
          return withProxyTiming(createUpstreamFailureResponse(lastError));
        },
      );
    } catch (error) {
      const ms = Math.round(performance.now() - startTime);
      const normalizedError = ensureError(error);
      if (req.signal.aborted) {
        lifecycle.end(499, normalizedError);
        throw normalizedError;
      }
      if (error instanceof ProxyRequestHostError) {
        lifecycle.end(400, normalizedError);
        throw error;
      }
      captureApplicationError(normalizedError, {
        boundary: "proxy.request",
        method: req.method,
        ...getTraceContext(),
      });
      proxyLogger.error(`500 ${req.method} ${url.pathname}`, { ms }, normalizedError);
      lifecycle.end(500, normalizedError);
      return withProxyTiming(
        jsonErrorResponse(500, {
          // Real error logged above via proxyLogger.error; keep body generic so
          // internal hostnames/paths in error.message are not leaked to clients.
          error: "Internal Proxy Error",
          message: "Internal Proxy Error",
        }),
      );
    }
  };

  return runProxyRequestLifecycle({
    req,
    url,
    startServerSpan,
    endSpan,
    extractContext,
    withContext,
    handle: execute,
  });
}

/**
 * Handle stats endpoint for monitoring.
 */
async function handleStats(): Promise<Response> {
  const stats = await proxyHandler.getStats();
  return new Response(JSON.stringify(stats, null, 2), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * Proxy API requests directly to Veryfront API (BFF pattern).
 * Routes: /_vf/api/* -> api.veryfront.com/*
 */
async function handleApiProxy(req: Request, url: URL): Promise<Response> {
  const token = await awaitAbortable(
    proxyHandler.getTokenForApi(req, { url }),
    req.signal,
  );
  if (!token) return jsonErrorResponse(401, { error: "No authentication token" });

  const apiPath = url.pathname.slice(API_PROXY_PATH_PREFIX.length) || "/";
  const apiUrl = createApiTargetUrl(config.apiBaseUrl, url);

  try {
    const response = await withSpan(
      ProxySpanNames.HTTP_CLIENT_FETCH,
      () =>
        fetchWithProxyDeadline(apiUrl, {
          timeoutMs: VERYFRONT_API_REQUEST_TIMEOUT_MS,
          signal: req.signal,
          init: {
            method: req.method,
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/json",
              "Content-Type": req.headers.get("Content-Type") || "application/json",
            },
            body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
            redirect: "manual",
          },
        }),
      {
        "http.method": req.method,
        "http.url": sanitizeUrlForSpan(apiUrl.toString()),
        "http.host": apiUrl.host,
        "proxy.target": "api",
        "proxy.api_path": apiPath,
      },
    );

    if (response.status >= 300 && response.status < 400) {
      await cancelProxyResponseBody(response);
      proxyLogger.warn("API proxy rejected an upstream redirect", {
        status: response.status,
        apiPath,
      });
      return jsonErrorResponse(502, { error: "Bad Gateway" });
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: {
        "Content-Type": response.headers.get("Content-Type") || "application/json",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (req.signal.aborted) throw ensureError(error);
    if (error instanceof ProxyOutboundRequestTimeoutError) {
      proxyLogger.error("API proxy request timed out", {
        apiPath,
        timeoutMs: VERYFRONT_API_REQUEST_TIMEOUT_MS,
      }, error);
      return jsonErrorResponse(504, {
        error: "Gateway Timeout",
        message: "Gateway Timeout",
      });
    }
    proxyLogger.error("API proxy error", error);
    // Real error logged above; keep body generic so internal hostnames/paths in
    // error.message are not leaked to clients.
    return jsonErrorResponse(502, {
      error: "Bad Gateway",
    });
  }
}

/**
 * Main router.
 */
async function router(req: Request): Promise<Response> {
  const url = new URL(req.url);

  if (url.pathname === "/_proxy/health") {
    return jsonErrorResponse(shuttingDown ? 503 : 200, {
      service: "veryfront-proxy",
      status: shuttingDown ? "draining" : "ok",
    });
  }
  if (shuttingDown) return createProxyDrainingResponse();

  const requestId = crypto.randomUUID();
  proxyRequestDrainTracker.start(requestId, req.method, url.pathname);

  try {
    let response: Response;
    if (isProxyWebSocketUpgrade(req)) {
      response = await handleWebSocketUpgrade(req, url);
    } else if (url.pathname === PROXY_ROUTING_INVALIDATION_PATH) {
      response = await handleProxyRoutingInvalidationRequest(req, {
        publisher: routingInvalidationBus,
      });
    } else if (url.pathname === "/_proxy/stats") {
      response = Object.keys(proxyHandler.localProjects).length === 0
        ? jsonErrorResponse(403, { error: "Forbidden" })
        : await handleStats();
    } else if (
      url.pathname === API_PROXY_PATH_PREFIX ||
      url.pathname.startsWith(`${API_PROXY_PATH_PREFIX}/`)
    ) {
      response = await handleApiProxy(req, url);
    } else if (isReleaseAssetPath(url.pathname)) {
      response = await handleReleaseAssetRequest(req, url, { apiBaseUrl: config.apiBaseUrl }) ??
        await forwardToServer(req, url);
    } else {
      response = await forwardToServer(req, url);
    }

    return proxyRequestDrainTracker.completeOnResponseEnd(requestId, response);
  } catch (error) {
    proxyRequestDrainTracker.complete(requestId);
    if (error instanceof ProxyRequestHostError) {
      proxyLogger.warn("Rejected request with an invalid Host header", {
        method: req.method,
        pathname: url.pathname,
      });
      return jsonErrorResponse(400, {
        error: "Bad Request",
        message: "Invalid Host header",
      });
    }
    throw error;
  }
}

// Create the facade before binding; startup rollback owns it until readiness.
const server = await acquireProxyStartupResource(
  "http-server",
  () => createHttpServer(),
  (httpServer) => httpServer.close(),
);

// Graceful shutdown
async function performShutdown(
  request: ProxyShutdownRequest,
  state: ProxyShutdownState,
): Promise<void> {
  shuttingDown = true;
  let shutdownFailed = state.hasListenerFailure();

  const shutdownMessage = request.source === "signal"
    ? `Received ${request.signal}, initiating graceful shutdown`
    : "Proxy HTTP listener failed, initiating graceful shutdown";
  proxyLogger.info(shutdownMessage, {
    source: request.source,
    activeWebSocketBridges: proxyWebSocketBridgeRegistry.size,
    inFlightRequests: proxyRequestDrainTracker.getInFlightCount(),
    drainTimeoutMs: SHUTDOWN_DRAIN_TIMEOUT_MS,
  });

  try {
    // New requests receive the draining response after shuttingDown is set.
    // Keep this replica subscribed while already-started responses finish.
    const drained = await proxyRequestDrainTracker.waitForDrain(SHUTDOWN_DRAIN_TIMEOUT_MS);
    if (!drained) {
      const now = performance.now();
      proxyLogger.warn("Proxy drain timeout exceeded, forcing shutdown", {
        remainingRequests: proxyRequestDrainTracker.getInFlightRequests().slice(0, 10).map(
          ({ requestId, method, path, startTime }) => ({
            requestId,
            method,
            path,
            elapsedMs: Math.round(now - startTime),
          }),
        ),
      });
    }
  } catch (error) {
    shutdownFailed = true;
    captureApplicationError(error, { boundary: "process.shutdown" });
    proxyLogger.error("Proxy request drain failed", { source: request.source }, error);
  }

  let serverClosed = false;
  const cleanupFailures = await runProxyShutdownSteps([
    {
      name: "routing-invalidation-bus",
      run: async () => await routingInvalidationBus?.close(),
    },
    {
      name: "websocket-bridges",
      run: () => proxyWebSocketBridgeRegistry.close(),
    },
    {
      name: "http-server",
      run: async () => {
        serverClosed = await closeProxyServerWithin(
          () => server.close(),
          PROXY_SERVER_CLOSE_TIMEOUT_MS,
        );
      },
    },
    {
      name: "renderer-router",
      run: () => rendererRouter?.close(),
    },
    {
      name: "server-resolver",
      run: () => serverResolver.close(),
    },
    {
      name: "proxy-handler",
      run: async () => await proxyHandler.close(),
    },
    {
      name: "token-cache",
      run: () => cache.close(),
    },
    {
      name: "telemetry",
      run: async () => await shutdownOTLP(),
    },
    {
      name: "application-errors",
      run: async () => await flushApplicationErrors(),
    },
    {
      name: "application-error-reporter",
      run: () => applicationErrorReporter.dispose(),
    },
    {
      name: "signal-handlers",
      run: () => signalHandlers?.dispose(),
    },
  ], SHUTDOWN_CLEANUP_TIMEOUT_MS);

  for (const failure of cleanupFailures) {
    if (failure.status === "timeout") {
      proxyLogger.error("Proxy shutdown step timed out", {
        step: failure.step,
        cleanupTimeoutMs: SHUTDOWN_CLEANUP_TIMEOUT_MS,
      });
    } else {
      proxyLogger.error(
        "Proxy shutdown step failed",
        { step: failure.step },
        failure.error,
      );
    }
  }
  if (cleanupFailures.length > 0) shutdownFailed = true;
  if (state.hasListenerFailure()) shutdownFailed = true;

  const serverCloseFailed = cleanupFailures.some(({ step }) => step === "http-server");
  if (!serverCloseFailed && !serverClosed) {
    proxyLogger.warn(
      "Proxy server close timed out; process exit will close remaining connections",
      {
        closeTimeoutMs: PROXY_SERVER_CLOSE_TIMEOUT_MS,
      },
    );
  }

  proxyLogger.info("Proxy shutdown cleanup finished", {
    failed: shutdownFailed,
  });
  exit(shutdownFailed ? 1 : 0);
}

shutdownCoordinator = await runProxyStartupStage(() =>
  createProxyShutdownCoordinator({
    performShutdown,
    reportListenerFailure: (error) => {
      captureApplicationError(error, { boundary: "process.runtime" });
      proxyLogger.error(
        "Proxy HTTP listener failed after readiness",
        {},
        error,
      );
    },
    handleShutdownFailure: async (error) => {
      try {
        captureApplicationError(error, { boundary: "process.shutdown" });
      } catch {
        // Terminal shutdown must not depend on diagnostics remaining healthy.
      }
      try {
        proxyLogger.error("Unhandled shutdown error", {}, error);
      } catch {
        // Continue to the owned flush/exit boundary.
      }
      try {
        await flushApplicationErrors();
      } catch (flushError) {
        try {
          proxyLogger.error("Failed to flush terminal shutdown diagnostics", {}, flushError);
        } catch {
          // Process termination remains authoritative.
        }
      }
      try {
        await applicationErrorReporter.dispose();
      } catch (disposeError) {
        try {
          proxyLogger.error(
            "Failed to dispose terminal application-error reporter",
            {},
            disposeError,
          );
        } catch {
          // Process termination remains authoritative.
        }
      }
      exit(1);
    },
  })
);
const runtimeShutdownCoordinator = shutdownCoordinator;

// Wait for sticky-session router to resolve its initial target list. A
// pre-commit signal rejects this boundary and lets startup rollback own every
// resource instead of taking the runtime's immediate-exit path.
await runProxyStartupStage(() => rendererRouter?.ready());

// Own telemetry before initialization. shutdownOTLP() waits for an in-flight
// initializer and invalidates its generation, so startup cancellation cannot
// publish an exporter after rollback.
startupRollback.own("telemetry", () => shutdownOTLP());
await runProxyStartupStage(() => initializeOTLPWithApis());

proxyLogger.debug("Starting proxy server (split mode)", {
  port: PORT,
  serverUrl: PRODUCTION_SERVER_URL,
  apiBaseUrl: config.apiBaseUrl,
});

// `onListen` is the only portable readiness boundary: Node's serve promise
// resolves at readiness, while Deno's remains pending for the listener lifetime.
const listener = await runProxyStartupStage(() =>
  startProxyListener({
    server,
    handler: router,
    port: PORT,
    hostname: HOST,
    commitStartup: () => startupSignalRouter.commit(() => startupRollback.commit()),
    onRuntimeFailure: (error) =>
      runtimeShutdownCoordinator.request({
        source: "http-listener",
        error,
      }),
  })
);
await runProxyStartupStage(() => listener.ready);
await listener.finished;
