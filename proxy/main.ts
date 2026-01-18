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

import { createProxyHandler, type ProxyConfig } from "./handler.ts";
import { createCacheFromEnv } from "./cache/index.ts";
import {
  endSpan,
  extractContext,
  initializeOTLPWithApis,
  injectContext,
  shutdownOTLP,
  startServerSpan,
  withContext,
} from "./tracing.ts";
import { proxyLogger } from "./logger.ts";
import { parseProjectDomain } from "../src/server/utils/domain-parser.ts";
import { exit, getEnv, onSignal } from "../src/platform/compat/process.ts";
import { createHttpServer, upgradeWebSocket } from "../src/platform/compat/http/index.ts";

// Configuration from environment variables
const config: ProxyConfig = {
  apiBaseUrl: getEnv("VERYFRONT_API_BASE_URL") ||
    "http://api.lvh.me:4000",
  clientId: getEnv("API_CLIENT_ID_VERYFRONT_RENDERER_PROXY") || "",
  clientSecret: getEnv("API_CLIENT_SECRET_VERYFRONT_RENDERER_PROXY") || "",
  // Preview uses same service account (scopes determine access)
  previewClientId: getEnv("API_CLIENT_ID_VERYFRONT_RENDERER_PROXY") || "",
  previewClientSecret: getEnv("API_CLIENT_SECRET_VERYFRONT_RENDERER_PROXY") || "",
  localProjects: getEnv("LOCAL_PROJECTS")
    ? JSON.parse(getEnv("LOCAL_PROJECTS")!)
    : {},
};

const RENDERER_URL = getEnv("RENDERER_URL") || "http://localhost:3001";
const PORT = parseInt(getEnv("PORT") || "8080");
const HOST = getEnv("HOST") || "0.0.0.0"; // Default to 0.0.0.0 for Kubernetes
const WS_CONNECT_TIMEOUT_MS = 30000;

// Initialize cache and proxy handler
const cache = createCacheFromEnv();
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
function handleWebSocketUpgrade(req: Request): Response {
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
  let connectTimeoutId: ReturnType<typeof setTimeout> | null = null;
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

    connectTimeoutId = setTimeout(() => {
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

/**
 * Forward request to renderer with proxy context as headers.
 */
async function forwardToRenderer(req: Request): Promise<Response> {
  const startTime = performance.now();
  const url = new URL(req.url);

  const parentContext = extractContext(req.headers);
  const spanInfo = startServerSpan(req.method, url.pathname, parentContext);

  const execute = async (): Promise<Response> => {
    try {
      // Process request through proxy handler
      const ctx = await proxyHandler.processRequest(req);

      const reqLogger = proxyLogger.child({
        ...(ctx.projectSlug && { project: ctx.projectSlug }),
        env: ctx.environment,
      });

      // Build headers for renderer
      const newHeaders = new Headers(req.headers);
      if (ctx.token) newHeaders.set("x-token", ctx.token);
      newHeaders.set("x-project-slug", ctx.projectSlug || "");
      newHeaders.set("x-environment", ctx.environment);
      newHeaders.set("x-forwarded-host", ctx.host);
      if (ctx.localPath) newHeaders.set("x-project-path", ctx.localPath);
      newHeaders.delete("host");

      injectContext(newHeaders);

      // Forward to renderer
      const rendererUrl = new URL(url.pathname + url.search, RENDERER_URL);
      const response = await fetch(rendererUrl.toString(), {
        method: req.method,
        headers: newHeaders,
        body: req.body,
        redirect: "manual",
      });

      const ms = Math.round(performance.now() - startTime);
      reqLogger.info(`${response.status} ${req.method} ${url.pathname}`, {
        ms,
      });

      endSpan(spanInfo?.span, response.status);

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (error) {
      const ms = Math.round(performance.now() - startTime);
      proxyLogger.error(
        `502 ${req.method} ${url.pathname}`,
        { ms },
        error as Error,
      );

      endSpan(spanInfo?.span, 502, error as Error);

      return new Response(
        JSON.stringify({
          error: "Proxy Error",
          message: error instanceof Error ? error.message : "Unknown error",
        }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
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
  if (!token) {
    return new Response(JSON.stringify({ error: "No authentication token" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Strip /_vf/api prefix and forward to API
  const apiPath = url.pathname.replace(/^\/_vf\/api/, "");
  const apiUrl = `${config.apiBaseUrl}${apiPath}${url.search}`;

  try {
    const response = await fetch(apiUrl, {
      method: req.method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": req.headers.get("Content-Type") || "application/json",
      },
      body: req.method !== "GET" && req.method !== "HEAD"
        ? req.body
        : undefined,
    });

    return new Response(response.body, {
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
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "API request failed",
      }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }
}

/**
 * Main router.
 */
function router(req: Request): Promise<Response> {
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
    return Promise.resolve(new Response("OK", { status: 200 }));
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
