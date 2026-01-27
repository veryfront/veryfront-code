/**
 * Veryfront Proxy Server (Split Mode)
 *
 * Standalone proxy server that forwards requests to a separate renderer process.
 * Used in production for security isolation of OAuth credentials.
 *
 * For combined mode (single process), use the renderer with --proxy flag instead.
 *
 * Environment Variables:
 * - API_CLIENT_ID_VERYFRONT_RENDERER_PROXY: OAuth client ID (from 1Password)
 * - API_CLIENT_SECRET_VERYFRONT_RENDERER_PROXY: OAuth client secret (from 1Password)
 * - RENDERER_URL: URL of the renderer service
 * - LOCAL_PROJECTS: JSON map of slug → filesystem path (for dev)
 * - CACHE_TYPE: "memory" (default) or "redis"
 * - REDIS_URL: Redis connection URL (required if CACHE_TYPE=redis)
 */
import * as dntShim from "../_dnt.shims.js";


import { createProxyHandler, type ProxyConfig } from "./handler.js";
import { createCacheFromEnv } from "./cache/index.js";
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
} from "./tracing.js";
import { proxyLogger } from "./logger.js";
import { parseProjectDomain } from "../src/server/utils/domain-parser.js";
import { exit, getEnv, onSignal } from "../src/platform/compat/process.js";
import { createHttpServer, upgradeWebSocket } from "../src/platform/compat/http/index.js";

// Configuration from environment variables
const config: ProxyConfig = {
  apiBaseUrl: getEnv("VERYFRONT_API_BASE_URL") ||
    "http://api.lvh.me:4000",
  clientId: getEnv("API_CLIENT_ID_VERYFRONT_RENDERER_PROXY") || "",
  clientSecret: getEnv("API_CLIENT_SECRET_VERYFRONT_RENDERER_PROXY") || "",
  // Preview uses same service account (scopes determine access)
  previewClientId: getEnv("API_CLIENT_ID_VERYFRONT_RENDERER_PROXY") || "",
  previewClientSecret: getEnv("API_CLIENT_SECRET_VERYFRONT_RENDERER_PROXY") || "",
  localProjects: getEnv("LOCAL_PROJECTS") ? JSON.parse(getEnv("LOCAL_PROJECTS")!) : {},
};

const RENDERER_URL = getEnv("RENDERER_URL") || "http://localhost:3001";
const PORT = parseInt(getEnv("PORT") || "8080");
const HOST = getEnv("HOST") || "0.0.0.0"; // Default to 0.0.0.0 for Kubernetes
const WS_CONNECT_TIMEOUT_MS = 30000;
// Timeout for forwarding requests to renderer (SSR can take time on cold start)
const RENDERER_REQUEST_TIMEOUT_MS = parseInt(getEnv("RENDERER_REQUEST_TIMEOUT_MS") || "90000");

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
 * Bridges browser WebSocket to renderer's HMR WebSocket endpoint.
 */
function handleWebSocketUpgrade(req: dntShim.Request): dntShim.Response {
  const url = new URL(req.url);
  const host = req.headers.get("host") || "";

  // Parse domain to extract project slug and environment
  const parsed = parseProjectDomain(host);
  const scope = parsed.environment === "preview" ? "preview" : "production";
  const projectSlug = parsed.slug || undefined;

  // Build renderer WebSocket URL
  const rendererWsUrl = RENDERER_URL.replace(/^http/, "ws");
  const targetUrl = new URL(`${rendererWsUrl}${url.pathname}${url.search}`);
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

  let rendererSocket: WebSocket | null = null;
  let connectTimeoutId: ReturnType<typeof dntShim.setTimeout> | null = null;
  let timedOut = false;

  const clearConnectTimeout = () => {
    if (connectTimeoutId) {
      clearTimeout(connectTimeoutId);
      connectTimeoutId = null;
    }
  };

  clientSocket.onopen = () => {
    proxyLogger.info("[WebSocket] Client connected, bridging to renderer", {
      targetUrl: targetUrl.toString(),
    });

    try {
      rendererSocket = new WebSocket(targetUrl.toString());
    } catch (error) {
      proxyLogger.error("[WebSocket] Failed to create renderer WebSocket", {
        error: error instanceof Error ? error.message : String(error),
        targetUrl: targetUrl.toString(),
      });
      clientSocket.close(1011, "Failed to connect to renderer");
      return;
    }

    connectTimeoutId = dntShim.setTimeout(() => {
      timedOut = true;
      proxyLogger.error("[WebSocket] Renderer connection timeout", {
        targetUrl: targetUrl.toString(),
        timeoutMs: WS_CONNECT_TIMEOUT_MS,
      });
      rendererSocket?.close();
      if (clientSocket.readyState === WebSocket.OPEN) {
        clientSocket.close(1001, "Renderer connection timeout");
      }
    }, WS_CONNECT_TIMEOUT_MS);

    rendererSocket.onopen = () => {
      clearConnectTimeout();
      if (timedOut) {
        rendererSocket?.close();
        return;
      }
      proxyLogger.info("[WebSocket] Renderer connected, bridge established", {
        projectSlug,
        environment: scope,
      });
    };

    rendererSocket.onmessage = (event) => {
      if (clientSocket.readyState === WebSocket.OPEN) {
        clientSocket.send(event.data);
      }
    };

    rendererSocket.onerror = (event) => {
      clearConnectTimeout();
      proxyLogger.error("[WebSocket] Renderer connection error", {
        projectSlug,
        environment: scope,
        targetUrl: targetUrl.toString(),
        error: event instanceof ErrorEvent ? event.message : "Unknown error",
      });
    };

    rendererSocket.onclose = (event) => {
      clearConnectTimeout();
      proxyLogger.info("[WebSocket] Renderer connection closed", {
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
    if (rendererSocket?.readyState === WebSocket.OPEN) {
      rendererSocket.send(event.data);
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
    if (rendererSocket?.readyState === WebSocket.OPEN) {
      rendererSocket.close();
    }
  };

  return response;
}

function jsonErrorResponse(status: number, body: Record<string, unknown>): dntShim.Response {
  return new dntShim.Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function forwardToRenderer(req: dntShim.Request): Promise<dntShim.Response> {
  const startTime = performance.now();
  const url = new URL(req.url);

  const parentContext = extractContext(req.headers);
  const spanInfo = startServerSpan(req.method, url.pathname, parentContext);

  const execute = async (): Promise<dntShim.Response> => {
    try {
      const ctx = await proxyHandler.processRequest(req);

      if (ctx.error) {
        const ms = Math.round(performance.now() - startTime);
        proxyLogger.error(`${ctx.error.status} ${req.method} ${url.pathname}`, {
          ms,
          domain: ctx.host,
        });
        endSpan(spanInfo?.span, ctx.error.status);

        // Handle redirect for protected environments
        if (ctx.error.redirectUrl) {
          return new dntShim.Response(null, {
            status: 302,
            headers: { Location: ctx.error.redirectUrl },
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

      const newHeaders = new dntShim.Headers(req.headers);
      if (ctx.token) newHeaders.set("x-token", ctx.token);
      newHeaders.set("x-project-slug", ctx.projectSlug || "");
      newHeaders.set("x-environment", ctx.environment);
      newHeaders.set("x-forwarded-host", ctx.host);
      if (ctx.localPath) newHeaders.set("x-project-path", ctx.localPath);
      // Forward project/release context for cache keying
      if (ctx.projectId) newHeaders.set("x-project-id", ctx.projectId);
      if (ctx.releaseId) newHeaders.set("x-release-id", ctx.releaseId);
      if (ctx.branchId) newHeaders.set("x-branch-id", ctx.branchId);
      if (ctx.branchName) newHeaders.set("x-branch-name", ctx.branchName);
      newHeaders.delete("host");

      injectContext(newHeaders);

      const rendererUrl = new URL(url.pathname + url.search, RENDERER_URL);

      // Create abort controller for timeout
      const abortController = new AbortController();
      const timeoutId = dntShim.setTimeout(() => {
        abortController.abort();
      }, RENDERER_REQUEST_TIMEOUT_MS);

      let response: dntShim.Response;
      try {
        response = await withSpan(
          ProxySpanNames.HTTP_CLIENT_FETCH,
          () =>
            dntShim.fetch(rendererUrl.toString(), {
              method: req.method,
              headers: newHeaders,
              body: req.body,
              redirect: "manual",
              signal: abortController.signal,
            }),
          {
            "http.method": req.method,
            "http.url": rendererUrl.toString(),
            "http.host": rendererUrl.host,
            "proxy.target": "renderer",
            "proxy.project_slug": ctx.projectSlug || "",
            "proxy.timeout_ms": RENDERER_REQUEST_TIMEOUT_MS,
          },
        );
      } finally {
        clearTimeout(timeoutId);
      }

      const ms = Math.round(performance.now() - startTime);
      reqLogger.info(`${response.status} ${req.method} ${url.pathname}`, { ms });

      endSpan(spanInfo?.span, response.status);

      return new dntShim.Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (error) {
      const ms = Math.round(performance.now() - startTime);

      // Handle timeout specifically
      if (error instanceof Error && error.name === "AbortError") {
        proxyLogger.error(`504 ${req.method} ${url.pathname}`, {
          ms,
          timeoutMs: RENDERER_REQUEST_TIMEOUT_MS,
        });
        endSpan(spanInfo?.span, 504, error);
        return jsonErrorResponse(504, {
          error: "Gateway Timeout",
          message: `Renderer request timed out after ${RENDERER_REQUEST_TIMEOUT_MS}ms`,
        });
      }

      proxyLogger.error(`502 ${req.method} ${url.pathname}`, { ms }, error as Error);
      endSpan(spanInfo?.span, 502, error as Error);
      return jsonErrorResponse(502, {
        error: "Proxy Error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  return spanInfo?.context ? withContext(spanInfo.context, execute) : execute();
}

/**
 * Handle stats endpoint for monitoring.
 */
async function handleStats(): Promise<dntShim.Response> {
  const stats = await proxyHandler.getStats();
  return new dntShim.Response(JSON.stringify(stats, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Proxy API requests directly to Veryfront API (BFF pattern).
 * Routes: /_vf/api/* -> api.veryfront.com/*
 */
async function handleApiProxy(req: dntShim.Request): Promise<dntShim.Response> {
  const url = new URL(req.url);

  const token = await proxyHandler.getTokenForApi(req);
  if (!token) {
    return jsonErrorResponse(401, { error: "No authentication token" });
  }

  // Strip /_vf/api prefix and forward to API
  const apiPath = url.pathname.replace(/^\/_vf\/api/, "");
  const apiUrl = `${config.apiBaseUrl}${apiPath}${url.search}`;
  const apiUrlObj = new URL(apiUrl);

  try {
    const response = await withSpan(
      ProxySpanNames.HTTP_CLIENT_FETCH,
      () =>
        dntShim.fetch(apiUrl, {
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

    return new dntShim.Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: {
        "Content-Type": response.headers.get("Content-Type") ||
          "application/json",
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
function router(req: dntShim.Request): Promise<dntShim.Response> {
  const url = new URL(req.url);

  // WebSocket upgrade
  if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
    return Promise.resolve(handleWebSocketUpgrade(req));
  }

  // Proxy endpoints
  if (url.pathname === "/_proxy/stats") {
    return handleStats();
  }

  if (url.pathname === "/_proxy/health") {
    return Promise.resolve(new dntShim.Response("OK", { status: 200 }));
  }

  // BFF: Proxy API requests directly to Veryfront API
  if (url.pathname.startsWith("/_vf/api/")) {
    return handleApiProxy(req);
  }

  // Forward all other requests to renderer
  return forwardToRenderer(req);
}

// Graceful shutdown
async function shutdown(): Promise<void> {
  proxyLogger.info("Shutting down");
  await proxyHandler.close();
  await shutdownOTLP();
  proxyLogger.info("Closed connections");
  exit(0);
}

onSignal("SIGINT", shutdown);
onSignal("SIGTERM", shutdown);

// Initialize tracing and start server
await initializeOTLPWithApis();

proxyLogger.debug("Starting proxy server (split mode)", {
  port: PORT,
  rendererUrl: RENDERER_URL,
  apiBaseUrl: config.apiBaseUrl,
});

// Create and start the HTTP server
const server = createHttpServer();
await server.serve(router, { port: PORT, hostname: HOST });
