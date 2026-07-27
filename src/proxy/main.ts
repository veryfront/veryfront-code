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
 * - SHUTDOWN_DRAIN_TIMEOUT_MS: Time to wait for active SSE responses during shutdown
 * - SHUTDOWN_CLEANUP_TIMEOUT_MS: Total cleanup budget after request draining
 */

import { createProxyHandler, INTERNAL_PROXY_HEADERS } from "./handler.ts";
import { createCacheFromEnv } from "./cache/index.ts";
import { ensureRedisTokenCacheStoreFromEnv } from "./cache/redis-extension.ts";
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
import { register } from "../extensions/contracts.ts";
import { importFirstPartyExtensionModule } from "#veryfront/extensions/first-party-import.ts";
import { INITIALIZATION_ERROR } from "#veryfront/errors";
import {
  endSpan,
  extractContext,
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

const startupConfig = readProxyStartupConfig();
const config = startupConfig.proxyConfig;
const PRODUCTION_SERVER_URL = startupConfig.productionServerUrl;

const rendererRouter = createRendererRouterFromEnvironment(
  PRODUCTION_SERVER_URL,
);

// Dedicated server resolver: routes environments to their dedicated server if assigned
const serverResolver = new ServerResolver(
  startupConfig.apiInternalUrl,
  startupConfig.apiInternalUser,
  startupConfig.apiInternalPass,
);

const { hostname: HOST, port: PORT } = startupConfig.binding;
const PROXY_SERVER_CLOSE_TIMEOUT_MS = 1_000;
const VERYFRONT_SERVER_REQUEST_TIMEOUT_MS = startupConfig.serverRequestTimeoutMs;
const VERYFRONT_SERVER_RETRY_COUNT = startupConfig.serverRetryCount;
const VERYFRONT_SERVER_RETRY_DELAY_MS = startupConfig.serverRetryDelayMs;
const SHUTDOWN_DRAIN_TIMEOUT_MS = startupConfig.shutdownDrainTimeoutMs;
const SHUTDOWN_CLEANUP_TIMEOUT_MS = startupConfig.shutdownCleanupTimeoutMs;
const routingInvalidationSecret = startupConfig.routingInvalidationSecret;
const proxyRequestDrainTracker = new ProxyRequestDrainTracker();
const proxyWebSocketBridgeRegistry = new ProxyWebSocketBridgeRegistry();
let shuttingDown = false;

const authProvider = await importFirstPartyExtensionModule<unknown>(
  "ext-auth-jwt",
  "@veryfront/ext-auth-jwt",
).then(createProxyAuthProvider).catch((error) => {
  throw INITIALIZATION_ERROR.create({
    detail: "The Veryfront proxy requires a valid ext-auth-jwt extension. " +
      "In npm deployments install @veryfront/ext-auth-jwt alongside veryfront.",
    cause: error,
  });
});
register("AuthProvider", authProvider);

// Initialize cache and proxy handler
await ensureRedisTokenCacheStoreFromEnv();
const cache = await createCacheFromEnv();
const routingInvalidationLogger = {
  debug: (msg: string, extra?: Record<string, unknown>) => proxyLogger.debug(msg, extra),
  info: (msg: string, extra?: Record<string, unknown>) => proxyLogger.info(msg, extra),
  warn: (msg: string, extra?: Record<string, unknown>) => proxyLogger.warn(msg, extra),
  error: (msg: string, error?: Error, extra?: Record<string, unknown>) =>
    proxyLogger.error(msg, extra ?? {}, error),
};
const proxyHandler = createProxyHandler({
  config,
  cache,
  logger: routingInvalidationLogger,
});
const routingInvalidationBus = await startProxyRoutingInvalidationBus({
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
    error instanceof Error ? error : new Error(String(error)),
  );
  return null;
});
if (startupConfig.production && !routingInvalidationBus) {
  throw new Error(
    "Proxy routing invalidation bus requires REDIS_URL and a valid VERYFRONT_PROXY_ROUTING_INVALIDATION_SECRET in production",
  );
}

// Validate configuration on startup
const missingCredentials = proxyHandler.validateConfig();
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
  const host = req.headers.get("host") || "";

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
          domain: ctx.host || host,
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

          const newHeaders = new Headers(req.headers);
          for (const header of INTERNAL_PROXY_HEADERS) newHeaders.delete(header);
          if (ctx.token) newHeaders.set("x-token", ctx.token);
          newHeaders.set("x-project-slug", ctx.projectSlug || "");
          newHeaders.set("x-environment", ctx.environment);
          newHeaders.set("x-forwarded-host", ctx.host);
          if (ctx.localPath) newHeaders.set("x-project-path", ctx.localPath);
          if (ctx.projectId) newHeaders.set("x-project-id", ctx.projectId);
          if (ctx.releaseId) newHeaders.set("x-release-id", ctx.releaseId);
          if (ctx.environmentId) newHeaders.set("x-environment-id", ctx.environmentId);
          if (ctx.branchId) newHeaders.set("x-branch-id", ctx.branchId);
          if (ctx.branchName) newHeaders.set("x-branch-name", ctx.branchName);
          newHeaders.delete("host");

          injectContext(newHeaders);

          const maxRetries = getUpstreamRetryCount(
            req,
            url.pathname,
            VERYFRONT_SERVER_RETRY_COUNT,
          );
          const upstreamBodies = getReplayableRequestBodies(req, maxRetries);
          let lastError: Error | null = null;
          // After a retryable connection error to a dedicated server, fall back to shared pool
          let skipDedicated = false;

          for (let attempt = 0; attempt <= maxRetries; attempt++) {
            // Resolve dedicated server per attempt so retries can fall back to shared pool
            const dedicatedServerUrl = skipDedicated ? null : await profileProxyServerTimingPhase(
              proxyTiming,
              "proxy.resolve_server",
              () => serverResolver.resolve(ctx.environmentId),
            );
            const baseUrl = dedicatedServerUrl ??
              rendererRouter?.resolve(ctx.projectSlug) ??
              PRODUCTION_SERVER_URL;
            // Collapse leading slashes to prevent protocol-relative URL interpretation (e.g. "//cms/..." → hostname "cms")
            const safePath = url.pathname.replace(/^\/\/+/, "/");
            const serverUrl = new URL(safePath + url.search, baseUrl);
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
              await new Promise((resolve) => setTimeout(resolve, VERYFRONT_SERVER_RETRY_DELAY_MS)); // no cleanup needed: one-shot
              markProxyServerTimingPhase(
                proxyTiming,
                "proxy.retry_delay",
                performance.now() - retryDelayStartedAt,
              );
            }

            const abortController = new AbortController();
            const timeoutId = setTimeout(() => {
              abortController.abort();
            }, VERYFRONT_SERVER_REQUEST_TIMEOUT_MS);

            try {
              const response = await profileProxyServerTimingPhase(
                proxyTiming,
                "proxy.upstream",
                () =>
                  withSpan(
                    ProxySpanNames.HTTP_CLIENT_FETCH,
                    () =>
                      fetch(serverUrl.toString(), {
                        method: req.method,
                        headers: newHeaders,
                        body: upstreamBodies[attempt] ?? null,
                        redirect: "manual",
                        signal: abortController.signal,
                      }),
                    {
                      "http.method": req.method,
                      "http.url": serverUrl.toString(),
                      "http.host": serverUrl.host,
                      "proxy.target": "server",
                      "proxy.project_slug": ctx.projectSlug || "",
                      "proxy.timeout_ms": VERYFRONT_SERVER_REQUEST_TIMEOUT_MS,
                      "proxy.retry_attempt": attempt,
                    },
                  ),
              );

              clearTimeout(timeoutId);
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
                    headers: response.headers,
                  }),
                ),
              );
            } catch (error) {
              clearTimeout(timeoutId);
              lastError = error as Error;

              if (error instanceof Error && error.name === "AbortError") {
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
                      error: error instanceof Error ? error.message : String(error),
                    },
                  );
                } else {
                  proxyLogger.warn(
                    `[Retry] Retryable connection error on attempt ${attempt + 1}`,
                    {
                      pathname: url.pathname,
                      error: error instanceof Error ? error.message : String(error),
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
          const logLevel = getProxyFailureLogLevel(
            UPSTREAM_FAILURE_STATUS,
            req.method,
            url.pathname,
          );
          proxyLogger[logLevel](
            `${UPSTREAM_FAILURE_STATUS} ${req.method} ${url.pathname}`,
            { ms },
            lastError as Error,
          );
          lifecycle.end(UPSTREAM_FAILURE_STATUS, lastError as Error);
          return withProxyTiming(createUpstreamFailureResponse(lastError));
        },
      );
    } catch (error) {
      const ms = Math.round(performance.now() - startTime);
      proxyLogger.error(`500 ${req.method} ${url.pathname}`, { ms }, error as Error);
      lifecycle.end(500, error as Error);
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
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Proxy API requests directly to Veryfront API (BFF pattern).
 * Routes: /_vf/api/* -> api.veryfront.com/*
 */
async function handleApiProxy(req: Request, url: URL): Promise<Response> {
  const token = await proxyHandler.getTokenForApi(req, { url });
  if (!token) return jsonErrorResponse(401, { error: "No authentication token" });

  const apiPath = url.pathname.replace(/^\/_vf\/api/, "");
  const apiUrl = `${config.apiBaseUrl}${apiPath}${url.search}`;
  const apiUrlObj = new URL(apiUrl);

  try {
    const response = await withSpan(
      ProxySpanNames.HTTP_CLIENT_FETCH,
      () =>
        fetch(apiUrl, {
          method: req.method,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            "Content-Type": req.headers.get("Content-Type") || "application/json",
          },
          body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
        }),
      {
        "http.method": req.method,
        "http.url": apiUrl,
        "http.host": apiUrlObj.host,
        "proxy.target": "api",
        "proxy.api_path": apiPath,
      },
    );

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: {
        "Content-Type": response.headers.get("Content-Type") || "application/json",
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    proxyLogger.error("API proxy error", error as Error);
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
    return Response.json({ service: "veryfront-proxy", status: "ok" });
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
        ? new Response("Forbidden", { status: 403 })
        : await handleStats();
    } else if (url.pathname.startsWith("/_vf/api/")) {
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
    throw error;
  }
}

// Create server before signal registration so early SIGTERM/SIGINT can close it safely.
const server = createHttpServer();

// Graceful shutdown
async function shutdown(signal: "SIGINT" | "SIGTERM"): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  let shutdownFailed = false;

  proxyLogger.info(`Received ${signal}, initiating graceful shutdown`, {
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
    proxyLogger.error("Proxy request drain failed", { signal }, error);
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
      name: "telemetry",
      run: async () => await shutdownOTLP(),
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

const handleSignal = (signal: "SIGINT" | "SIGTERM"): void => {
  void shutdown(signal).catch((error) => {
    proxyLogger.error("Unhandled shutdown error", { signal }, error);
    exit(1);
  });
};

onSignal("SIGINT", () => handleSignal("SIGINT"));
onSignal("SIGTERM", () => handleSignal("SIGTERM"));

// Wait for sticky-session router to resolve initial target list
await rendererRouter?.ready();

// Initialize tracing and start server
await initializeOTLPWithApis();

proxyLogger.debug("Starting proxy server (split mode)", {
  port: PORT,
  serverUrl: PRODUCTION_SERVER_URL,
  apiBaseUrl: config.apiBaseUrl,
});

// Start the HTTP server
await server.serve(router, { port: PORT, hostname: HOST });
