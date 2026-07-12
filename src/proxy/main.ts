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
 * - VERYFRONT_API_INTERNAL_URL: API URL for internal endpoints (falls back to VERYFRONT_PROXY_API_BASE_URL)
 * - VERYFRONT_API_INTERNAL_USER: Basic auth user for internal API
 * - VERYFRONT_API_INTERNAL_PASS: Basic auth pass for internal API
 * - SHUTDOWN_DRAIN_TIMEOUT_MS: Time to wait for active SSE responses during shutdown
 */

import { createProxyHandler, INTERNAL_PROXY_HEADERS, type ProxyConfig } from "./handler.ts";
import { createCacheFromEnv } from "./cache/index.ts";
import {
  getReplayableRequestBodies,
  getUpstreamRetryCount,
  shouldRetryUpstreamRequest,
} from "./retry.ts";
import {
  authorizeWebSocketRequest,
  closeBridgePeer,
  createProxyClientWebSocketUpgradeOptions,
  getClientWebSocketErrorLogLevel,
  getServerWebSocketErrorLogLevel,
} from "./websocket-bridge.ts";
import { register } from "../extensions/contracts.ts";
import { importFirstPartyExtensionModule } from "#veryfront/extensions/first-party-import.ts";
import type { AuthProvider } from "#veryfront/extensions/auth/index.ts";
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
import { RendererRouter } from "./renderer-router.ts";
import { ServerResolver } from "./server-resolver.ts";
import { exit, getEnv, onSignal } from "#veryfront/platform/compat/process.ts";
import { isProduction } from "#veryfront/platform/environment.ts";
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
  parseProxyDrainTimeoutMs,
  ProxyRequestDrainTracker,
} from "./request-drain.ts";

type AuthJwtExtensionModule = {
  createAuthProvider: (options?: Record<string, unknown>) => AuthProvider;
};

function getLocalProjects(): Record<string, string> {
  const raw = getEnv("LOCAL_PROJECTS");
  return raw ? (JSON.parse(raw) as Record<string, string>) : {};
}

// Configuration from environment variables
const apiClientId = getEnv("VERYFRONT_PROXY_API_CLIENT_ID") || "";
const apiClientSecret = getEnv("VERYFRONT_PROXY_API_CLIENT_SECRET") || "";

const config: ProxyConfig = {
  apiBaseUrl: getEnv("VERYFRONT_PROXY_API_BASE_URL") || "https://api.veryfront.com",
  apiClientId,
  apiClientSecret,
  // Preview uses same service account (scopes determine access)
  previewApiClientId: apiClientId,
  previewApiClientSecret: apiClientSecret,
  localProjects: getLocalProjects(),
};

function resolveProxyBinding(): { hostname: string; port: number } {
  const proxyUrlRaw = getEnv("VERYFRONT_PROXY_URL");
  if (proxyUrlRaw) {
    const proxyUrl = new URL(proxyUrlRaw);
    const port = proxyUrl.port ? Number(proxyUrl.port) : proxyUrl.protocol === "https:" ? 443 : 80;
    return { hostname: proxyUrl.hostname, port };
  }

  const port = parseInt(getEnv("PORT") || "8080");
  const hostname = getEnv("HOST") || "0.0.0.0";
  return { hostname, port };
}

const serverUrlFromEnv = getEnv("VERYFRONT_SERVER_URL");
// Fail closed in production: never silently forward to localhost.
if (!serverUrlFromEnv && isProduction()) {
  throw new Error(
    "VERYFRONT_SERVER_URL is required in production: refusing to fall back to http://localhost:3001.",
  );
}
const PRODUCTION_SERVER_URL = serverUrlFromEnv || "http://localhost:3001";

const discoveryHost = getEnv("VERYFRONT_SERVER_DISCOVERY_HOST");
const staticTargets = getEnv("VERYFRONT_SERVER_TARGETS");
const rendererRouter = (discoveryHost || staticTargets)
  ? new RendererRouter(
    discoveryHost || "static-targets",
    PRODUCTION_SERVER_URL,
    parseInt(getEnv("VERYFRONT_SERVER_DISCOVERY_INTERVAL_MS") || "15000") || 15_000,
  )
  : null;

// Dedicated server resolver: routes environments to their dedicated server if assigned
const apiInternalUrl = getEnv("VERYFRONT_API_INTERNAL_URL") || config.apiBaseUrl;
const apiInternalUser = getEnv("VERYFRONT_API_INTERNAL_USER") || "";
const apiInternalPass = getEnv("VERYFRONT_API_INTERNAL_PASS") || "";
const serverResolver = new ServerResolver(apiInternalUrl, apiInternalUser, apiInternalPass);

const { hostname: HOST, port: PORT } = resolveProxyBinding();
const WS_CONNECT_TIMEOUT_MS = 30_000;
// Timeout for forwarding requests to production server (SSR can take time on cold start)
const DEFAULT_SERVER_REQUEST_TIMEOUT_MS = 90_000;
const DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS = 25_000;
const PROXY_SERVER_CLOSE_TIMEOUT_MS = 1_000;
const VERYFRONT_SERVER_REQUEST_TIMEOUT_MS = parseInt(
  getEnv("VERYFRONT_SERVER_REQUEST_TIMEOUT_MS") || String(DEFAULT_SERVER_REQUEST_TIMEOUT_MS),
);
// Retry configuration for transient connection errors
const DEFAULT_SERVER_RETRY_COUNT = 1;
const DEFAULT_SERVER_RETRY_DELAY_MS = 100;
const VERYFRONT_SERVER_RETRY_COUNT = parseInt(
  getEnv("VERYFRONT_SERVER_RETRY_COUNT") || String(DEFAULT_SERVER_RETRY_COUNT),
);
const VERYFRONT_SERVER_RETRY_DELAY_MS = parseInt(
  getEnv("VERYFRONT_SERVER_RETRY_DELAY_MS") || String(DEFAULT_SERVER_RETRY_DELAY_MS),
);
const SHUTDOWN_DRAIN_TIMEOUT_MS = parseProxyDrainTimeoutMs(
  getEnv("SHUTDOWN_DRAIN_TIMEOUT_MS"),
  DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS,
);
const proxyRequestDrainTracker = new ProxyRequestDrainTracker();
let shuttingDown = false;

const { createAuthProvider } = await importFirstPartyExtensionModule<AuthJwtExtensionModule>(
  "ext-auth-jwt",
  "@veryfront/ext-auth-jwt",
).catch((error) => {
  throw new Error(
    `The Veryfront proxy requires the ext-auth-jwt extension. In npm deployments install @veryfront/ext-auth-jwt alongside veryfront. ${
      error instanceof Error ? error.message : String(error)
    }`,
    { cause: error },
  );
});
register("AuthProvider", createAuthProvider({}));

// Initialize cache and proxy handler
const cache = await createCacheFromEnv();
const proxyHandler = createProxyHandler({
  config,
  cache,
  logger: {
    debug: (msg, extra) => proxyLogger.debug(msg, extra),
    info: (msg, extra) => proxyLogger.info(msg, extra),
    warn: (msg, extra) => proxyLogger.warn(msg, extra),
    error: (msg, error, extra) => proxyLogger.error(msg, extra ?? {}, error),
  },
});

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

  const serverWsUrl = PRODUCTION_SERVER_URL.replace(/^http/, "ws");
  const safePath = url.pathname.replace(/^\/\/+/, "/");
  const targetUrl = new URL(`${serverWsUrl}${safePath}${url.search}`);
  targetUrl.searchParams.set("x-project-slug", projectSlug || "");
  targetUrl.searchParams.set("x-environment", scope);

  proxyLogger.info("[WebSocket] Upgrade request received", {
    host,
    path: url.pathname,
    projectSlug,
    environment: scope,
    parsedEnvironment: context.parsedDomain.environment,
    targetUrl: targetUrl.toString(),
  });

  const { socket: clientSocket, response } = upgradeWebSocket(
    req,
    createProxyClientWebSocketUpgradeOptions(),
  );

  let serverSocket: WebSocket | null = null;
  let connectTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;

  const clearConnectTimeout = (): void => {
    if (!connectTimeoutId) return;
    clearTimeout(connectTimeoutId);
    connectTimeoutId = null;
  };

  clientSocket.onopen = () => {
    proxyLogger.info("[WebSocket] Client connected, bridging to server", {
      targetUrl: targetUrl.toString(),
    });

    try {
      serverSocket = new WebSocket(targetUrl.toString());
    } catch (error) {
      proxyLogger.error("[WebSocket] Failed to create server WebSocket", {
        error: error instanceof Error ? error.message : String(error),
        targetUrl: targetUrl.toString(),
      });
      clientSocket.close(1011, "Failed to connect to server");
      return;
    }

    connectTimeoutId = setTimeout(() => {
      timedOut = true;
      proxyLogger.error("[WebSocket] Server connection timeout", {
        targetUrl: targetUrl.toString(),
        timeoutMs: WS_CONNECT_TIMEOUT_MS,
      });
      serverSocket?.close();
      if (clientSocket.readyState === WebSocket.OPEN) {
        clientSocket.close(1001, "Server connection timeout");
      }
    }, WS_CONNECT_TIMEOUT_MS);

    serverSocket.onopen = () => {
      clearConnectTimeout();
      if (timedOut) {
        serverSocket?.close();
        return;
      }
      proxyLogger.info("[WebSocket] Server connected, bridge established", {
        projectSlug,
        environment: scope,
      });
    };

    serverSocket.onmessage = (event) => {
      if (clientSocket.readyState === WebSocket.OPEN) {
        clientSocket.send(event.data);
      }
    };

    serverSocket.onerror = (event) => {
      clearConnectTimeout();
      const error = event instanceof ErrorEvent ? event.message : "Unknown error";
      const logLevel = getServerWebSocketErrorLogLevel(error);
      proxyLogger[logLevel]("[WebSocket] Server connection error", {
        projectSlug,
        environment: scope,
        targetUrl: targetUrl.toString(),
        error,
      });
      closeBridgePeer(clientSocket, 1011, "Server connection error");
      closeBridgePeer(serverSocket, 1011, "Server connection error");
    };

    serverSocket.onclose = (event) => {
      clearConnectTimeout();
      proxyLogger.info("[WebSocket] Server connection closed", {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
      });
      if (clientSocket.readyState === WebSocket.OPEN) {
        clientSocket.close(event.code, event.reason);
      }
    };
  };

  clientSocket.onmessage = (event) => {
    if (serverSocket?.readyState === WebSocket.OPEN) {
      serverSocket.send(event.data);
    }
  };

  clientSocket.onerror = (event) => {
    clearConnectTimeout();
    const error = event instanceof ErrorEvent ? event.message : "Unknown error";
    const logLevel = getClientWebSocketErrorLogLevel(error);
    proxyLogger[logLevel]("[WebSocket] Client connection error", {
      error,
    });
  };

  clientSocket.onclose = (event) => {
    clearConnectTimeout();
    proxyLogger.info("[WebSocket] Client connection closed", {
      code: event.code,
      reason: event.reason,
      wasClean: event.wasClean,
    });
    if (serverSocket?.readyState === WebSocket.OPEN) {
      serverSocket.close();
    }
  };

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
          error: "Internal Proxy Error",
          message: error instanceof Error ? error.message : "Unknown error",
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
    return jsonErrorResponse(502, {
      error: error instanceof Error ? error.message : "API request failed",
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
    if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
      response = await handleWebSocketUpgrade(req, url);
    } else if (url.pathname === "/_proxy/stats") {
      response = Object.keys(proxyHandler.localProjects).length === 0
        ? new Response("Forbidden", { status: 403 })
        : await handleStats();
    } else if (url.pathname.startsWith("/_vf/api/")) {
      response = await handleApiProxy(req, url);
    } else if (isReleaseAssetPath(url.pathname)) {
      response = await handleReleaseAssetRequest(url, { apiBaseUrl: config.apiBaseUrl }) ??
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

  proxyLogger.info(`Received ${signal}, initiating graceful shutdown`, {
    inFlightRequests: proxyRequestDrainTracker.getInFlightCount(),
    drainTimeoutMs: SHUTDOWN_DRAIN_TIMEOUT_MS,
  });

  try {
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

    const closed = await closeProxyServerWithin(
      () => server.close(),
      PROXY_SERVER_CLOSE_TIMEOUT_MS,
    );
    if (!closed) {
      proxyLogger.warn(
        "Proxy server close timed out; process exit will close remaining connections",
        {
          closeTimeoutMs: PROXY_SERVER_CLOSE_TIMEOUT_MS,
        },
      );
    }
    rendererRouter?.close();
    serverResolver.close();
    await proxyHandler.close();
    await shutdownOTLP();
    proxyLogger.info("Closed connections");
  } catch (error) {
    proxyLogger.error("Error while shutting down proxy", error);
  } finally {
    exit(0);
  }
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
