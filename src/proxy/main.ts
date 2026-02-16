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
 */

import { createProxyHandler, INTERNAL_PROXY_HEADERS, type ProxyConfig } from "./handler.ts";
import { createCacheFromEnv } from "./cache/index.ts";
import { isRetryableConnectionError } from "./retry.ts";
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
import { ErrorPages } from "../server/utils/error-html.ts";
import { RendererRouter } from "./renderer-router.ts";
import { ServerResolver } from "./server-resolver.ts";
import { parseProjectDomain } from "#veryfront/server/utils/domain-parser.ts";
import { exit, getEnv, onSignal } from "#veryfront/platform/compat/process.ts";
import { createHttpServer, upgradeWebSocket } from "#veryfront/platform/compat/http/index.ts";

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

const PRODUCTION_SERVER_URL = getEnv("VERYFRONT_SERVER_URL") || "http://localhost:3001";

const discoveryHost = getEnv("VERYFRONT_SERVER_DISCOVERY_HOST");
const staticTargets = getEnv("VERYFRONT_SERVER_TARGETS");
const rendererRouter = (discoveryHost || staticTargets)
  ? new RendererRouter(
    discoveryHost || "static-targets",
    PRODUCTION_SERVER_URL,
    parseInt(getEnv("VERYFRONT_SERVER_DISCOVERY_INTERVAL_MS") || "15000") || 15000,
  )
  : null;

// Dedicated server resolver: routes environments to their dedicated server if assigned
const apiInternalUrl = getEnv("VERYFRONT_API_INTERNAL_URL") || config.apiBaseUrl;
const apiInternalUser = getEnv("VERYFRONT_API_INTERNAL_USER") || "";
const apiInternalPass = getEnv("VERYFRONT_API_INTERNAL_PASS") || "";
const serverResolver = new ServerResolver(apiInternalUrl, apiInternalUser, apiInternalPass);

const { hostname: HOST, port: PORT } = resolveProxyBinding();
const WS_CONNECT_TIMEOUT_MS = 30000;
// Timeout for forwarding requests to production server (SSR can take time on cold start)
const VERYFRONT_SERVER_REQUEST_TIMEOUT_MS = parseInt(
  getEnv("VERYFRONT_SERVER_REQUEST_TIMEOUT_MS") || "90000",
);
// Retry configuration for transient connection errors
const VERYFRONT_SERVER_RETRY_COUNT = parseInt(getEnv("VERYFRONT_SERVER_RETRY_COUNT") || "1");
const VERYFRONT_SERVER_RETRY_DELAY_MS = parseInt(
  getEnv("VERYFRONT_SERVER_RETRY_DELAY_MS") || "100",
);

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
function handleWebSocketUpgrade(req: Request): Response {
  const url = new URL(req.url);
  const host = req.headers.get("host") || "";

  const parsed = parseProjectDomain(host);
  const scope = parsed.environment === "preview" ? "preview" : "production";
  const projectSlug = parsed.slug || undefined;

  const serverWsUrl = PRODUCTION_SERVER_URL.replace(/^http/, "ws");
  const targetUrl = new URL(`${serverWsUrl}${url.pathname}${url.search}`);
  targetUrl.searchParams.set("x-project-slug", projectSlug || "");
  targetUrl.searchParams.set("x-environment", scope);

  proxyLogger.info("[WebSocket] Upgrade request received", {
    host,
    path: url.pathname,
    projectSlug,
    environment: scope,
    parsedEnvironment: parsed.environment,
    targetUrl: targetUrl.toString(),
  });

  const { socket: clientSocket, response } = upgradeWebSocket(req);

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
      proxyLogger.error("[WebSocket] Server connection error", {
        projectSlug,
        environment: scope,
        targetUrl: targetUrl.toString(),
        error: event instanceof ErrorEvent ? event.message : "Unknown error",
      });
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
    proxyLogger.error("[WebSocket] Client connection error", {
      error: event instanceof ErrorEvent ? event.message : "Unknown error",
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

function jsonErrorResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function forwardToServer(req: Request): Promise<Response> {
  const startTime = performance.now();
  const url = new URL(req.url);
  const requestId = crypto.randomUUID();
  const host = req.headers.get("host") || "";

  const parentContext = extractContext(req.headers);
  const spanInfo = startServerSpan(req.method, url.pathname, parentContext);

  const execute = async (): Promise<Response> => {
    try {
      const ctx = await proxyHandler.processRequest(req);

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
            const logLevel = ctx.error.status < 500 ? "warn" : "error";
            proxyLogger[logLevel](`${ctx.error.status} ${req.method} ${url.pathname}`, { ms });
            endSpan(spanInfo?.span, ctx.error.status);

            if (ctx.error.redirectUrl) {
              return new Response(null, {
                status: 302,
                headers: { Location: ctx.error.redirectUrl },
              });
            }

            if (ctx.error.slug === "release-not-found") {
              return new Response(ErrorPages.notFound(), {
                status: 404,
                headers: { "Content-Type": "text/html; charset=utf-8" },
              });
            }

            return jsonErrorResponse(ctx.error.status, {
              error: ctx.error.message,
              status: ctx.error.status,
            });
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

          // Only retry idempotent methods (GET, HEAD, OPTIONS)
          const isIdempotent = ["GET", "HEAD", "OPTIONS"].includes(req.method);
          const maxRetries = isIdempotent ? VERYFRONT_SERVER_RETRY_COUNT : 0;
          let lastError: Error | null = null;
          // After a retryable connection error to a dedicated server, fall back to shared pool
          let skipDedicated = false;

          for (let attempt = 0; attempt <= maxRetries; attempt++) {
            // Resolve dedicated server per attempt so retries can fall back to shared pool
            const dedicatedServerUrl = skipDedicated
              ? null
              : await serverResolver.resolve(ctx.environmentId);
            const baseUrl = dedicatedServerUrl ??
              rendererRouter?.resolve(ctx.projectSlug) ??
              PRODUCTION_SERVER_URL;
            const serverUrl = new URL(url.pathname + url.search, baseUrl);
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
              await new Promise((resolve) => setTimeout(resolve, VERYFRONT_SERVER_RETRY_DELAY_MS));
            }

            const abortController = new AbortController();
            const timeoutId = setTimeout(() => {
              abortController.abort();
            }, VERYFRONT_SERVER_REQUEST_TIMEOUT_MS);

            try {
              const response = await withSpan(
                ProxySpanNames.HTTP_CLIENT_FETCH,
                () =>
                  fetch(serverUrl.toString(), {
                    method: req.method,
                    headers: newHeaders,
                    body: req.body,
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

              endSpan(spanInfo?.span, response.status);

              return new Response(response.body, {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
              });
            } catch (error) {
              clearTimeout(timeoutId);
              lastError = error as Error;

              if (error instanceof Error && error.name === "AbortError") {
                const ms = Math.round(performance.now() - startTime);
                proxyLogger.error(`504 ${req.method} ${url.pathname}`, {
                  ms,
                  timeoutMs: VERYFRONT_SERVER_REQUEST_TIMEOUT_MS,
                });
                endSpan(spanInfo?.span, 504, error);
                return jsonErrorResponse(504, {
                  error: "Gateway Timeout",
                  message:
                    `Server request timed out after ${VERYFRONT_SERVER_REQUEST_TIMEOUT_MS}ms`,
                });
              }

              // Check if this is a retryable error and we have retries left
              if (isRetryableConnectionError(error) && attempt < maxRetries) {
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
          proxyLogger.error(`502 ${req.method} ${url.pathname}`, { ms }, lastError as Error);
          endSpan(spanInfo?.span, 502, lastError as Error);
          return jsonErrorResponse(502, {
            error: "Proxy Error",
            message: lastError instanceof Error ? lastError.message : "Unknown error",
          });
        },
      );
    } catch (error) {
      const ms = Math.round(performance.now() - startTime);
      proxyLogger.error(`500 ${req.method} ${url.pathname}`, { ms }, error as Error);
      endSpan(spanInfo?.span, 500, error as Error);
      return jsonErrorResponse(500, {
        error: "Internal Proxy Error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  return spanInfo?.context ? withContext(spanInfo.context, execute) : execute();
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
async function handleApiProxy(req: Request): Promise<Response> {
  const url = new URL(req.url);

  const token = await proxyHandler.getTokenForApi(req);
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
function router(req: Request): Promise<Response> {
  const url = new URL(req.url);

  if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
    return Promise.resolve(handleWebSocketUpgrade(req));
  }

  switch (url.pathname) {
    case "/_proxy/stats":
      return handleStats();
    case "/_proxy/health":
      return Promise.resolve(
        Response.json({ service: "veryfront-proxy", status: "ok" }),
      );
  }

  if (url.pathname.startsWith("/_vf/api/")) return handleApiProxy(req);

  return forwardToServer(req);
}

// Graceful shutdown
async function shutdown(): Promise<void> {
  proxyLogger.info("Shutting down");
  rendererRouter?.close();
  serverResolver.close();
  await proxyHandler.close();
  await shutdownOTLP();
  proxyLogger.info("Closed connections");
  exit(0);
}

onSignal("SIGINT", shutdown);
onSignal("SIGTERM", shutdown);

// Wait for sticky-session router to resolve initial target list
await rendererRouter?.ready();

// Initialize tracing and start server
await initializeOTLPWithApis();

proxyLogger.debug("Starting proxy server (split mode)", {
  port: PORT,
  serverUrl: PRODUCTION_SERVER_URL,
  apiBaseUrl: config.apiBaseUrl,
});

// Create and start the HTTP server
const server = createHttpServer();
await server.serve(router, { port: PORT, hostname: HOST });
