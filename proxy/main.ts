/**
 * Veryfront Deno Proxy
 *
 * Lightweight proxy that handles OAuth token management and forwards requests
 * to the Deno renderer with authentication headers.
 *
 * Security: OAuth credentials are isolated in this proxy, not in the renderer.
 * If the renderer is compromised, only the current short-lived token is exposed.
 *
 * Environment Variables:
 * - OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET: Production OAuth credentials
 * - OAUTH_PREVIEW_CLIENT_ID, OAUTH_PREVIEW_CLIENT_SECRET: Preview OAuth credentials
 * - CACHE_TYPE: "memory" (default) or "redis"
 * - REDIS_URL: Redis connection URL (required if CACHE_TYPE=redis)
 * - REDIS_PREFIX: Key prefix for Redis (default: "vf:token:")
 * - LOG_FORMAT: "json" (default in production) or "text"
 */

import { TokenManager, type TokenScope } from "./token-manager.ts";
import { parseProjectDomain } from "../src/server/utils/domain-parser.ts";
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

// Configuration from environment variables
const config = {
  apiBaseUrl: Deno.env.get("VERYFRONT_API_BASE_URL") ||
    "http://api.lvh.me:4000",
  clientId: Deno.env.get("OAUTH_CLIENT_ID") || "",
  clientSecret: Deno.env.get("OAUTH_CLIENT_SECRET") || "",
  previewClientId: Deno.env.get("OAUTH_PREVIEW_CLIENT_ID") || "",
  previewClientSecret: Deno.env.get("OAUTH_PREVIEW_CLIENT_SECRET") || "",
};

const RENDERER_URL = Deno.env.get("RENDERER_URL") || "http://localhost:3001";
const PORT = parseInt(Deno.env.get("PORT") || "8080");

// Validate required configuration
function validateConfig(): void {
  const missing: string[] = [];

  if (!config.clientId) missing.push("OAUTH_CLIENT_ID");
  if (!config.clientSecret) missing.push("OAUTH_CLIENT_SECRET");
  if (!config.previewClientId) missing.push("OAUTH_PREVIEW_CLIENT_ID");
  if (!config.previewClientSecret) missing.push("OAUTH_PREVIEW_CLIENT_SECRET");

  if (missing.length > 0) {
    proxyLogger.warn("Missing OAuth credentials", {
      missingCredentials: missing,
    });
    proxyLogger.warn("Proxy will forward requests without authentication");
  }
}

// Initialize cache and token manager
const cache = createCacheFromEnv();
const tokenManager = new TokenManager(config, { cache });

/**
 * Determine the OAuth scope based on the parsed domain environment.
 */
function getScope(environment: string | null): TokenScope {
  return environment === "preview" ? "preview" : "production";
}

/**
 * Handle WebSocket upgrade requests by proxying to renderer.
 */
function handleWebSocketUpgrade(req: Request): Response {
  const url = new URL(req.url);
  const host = req.headers.get("host") || "";
  const parsed = parseProjectDomain(host);
  const scope = getScope(parsed.environment);
  const projectSlug = parsed.slug || undefined;

  proxyLogger.info("WebSocket upgrade request", {
    path: url.pathname,
    projectSlug,
    environment: scope,
  });

  // Upgrade the client connection
  const { socket: clientSocket, response } = Deno.upgradeWebSocket(req);

  // Build renderer WebSocket URL
  const rendererWsUrl = RENDERER_URL.replace(/^http/, "ws");
  const targetUrl = `${rendererWsUrl}${url.pathname}${url.search}`;

  // Connect to renderer WebSocket with auth headers as query params
  // (WebSocket doesn't support custom headers, so we pass token via query)
  const targetUrlWithAuth = new URL(targetUrl);
  // For preview HMR, we don't need token - it's internal renderer communication
  targetUrlWithAuth.searchParams.set("x-project-slug", projectSlug || "");
  targetUrlWithAuth.searchParams.set("x-environment", scope);

  let rendererSocket: WebSocket | null = null;

  clientSocket.onopen = () => {
    proxyLogger.debug("Client WebSocket opened, connecting to renderer", {
      targetUrl: targetUrlWithAuth.toString().replace(/token=[^&]+/, "token=***"),
    });

    rendererSocket = new WebSocket(targetUrlWithAuth.toString());

    rendererSocket.onopen = () => {
      proxyLogger.debug("Renderer WebSocket connected");
    };

    rendererSocket.onmessage = (event) => {
      // Forward renderer messages to client
      proxyLogger.debug("Renderer->Client message", {
        data: typeof event.data === 'string' ? event.data.slice(0, 100) : 'binary',
        clientState: clientSocket.readyState
      });
      if (clientSocket.readyState === WebSocket.OPEN) {
        clientSocket.send(event.data);
      }
    };

    rendererSocket.onerror = (error) => {
      proxyLogger.error("Renderer WebSocket error", { error });
    };

    rendererSocket.onclose = () => {
      proxyLogger.debug("Renderer WebSocket closed");
      if (clientSocket.readyState === WebSocket.OPEN) {
        clientSocket.close();
      }
    };
  };

  clientSocket.onmessage = (event) => {
    // Forward client messages to renderer
    if (rendererSocket?.readyState === WebSocket.OPEN) {
      rendererSocket.send(event.data);
    }
  };

  clientSocket.onerror = (error) => {
    proxyLogger.error("Client WebSocket error", { error });
  };

  clientSocket.onclose = () => {
    proxyLogger.debug("Client WebSocket closed");
    if (rendererSocket?.readyState === WebSocket.OPEN) {
      rendererSocket.close();
    }
  };

  return response;
}

async function handleRequest(req: Request): Promise<Response> {
  const startTime = performance.now();
  const host = req.headers.get("host") || "";
  const url = new URL(req.url);

  // Handle WebSocket upgrade requests
  if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
    return handleWebSocketUpgrade(req);
  }

  const parentContext = extractContext(req.headers);
  const spanInfo = startServerSpan(req.method, url.pathname, parentContext);

  const execute = async (): Promise<Response> => {
    try {
      const parsed = parseProjectDomain(host);
      const scope = getScope(parsed.environment);
      const projectSlug = parsed.slug || undefined;

      const reqLogger = proxyLogger.child({
        projectSlug,
        method: req.method,
        path: url.pathname,
        environment: scope,
      });

      reqLogger.info("Request received");

      let token = "";

      // For preview requests, try to use user's auth token from cookie first.
      // This allows previewing user-owned projects that aren't accessible via OAuth client credentials.
      if (scope === "preview") {
        const cookieHeader = req.headers.get("cookie") || "";
        const authTokenMatch = cookieHeader.match(/(?:^|;\s*)authToken=([^;]+)/);
        if (authTokenMatch?.[1]) {
          token = decodeURIComponent(authTokenMatch[1]);
          reqLogger.info("Using user auth token for preview");
        }
      }

      // Fall back to OAuth client credentials if no user token or for production requests
      if (!token && config.clientId && config.clientSecret) {
        try {
          // Don't pass projectSlug as projectId - the API expects a UUID, not a slug.
          // The token works globally for all projects under the OAuth client credentials.
          token = await tokenManager.getToken(scope);
        } catch (error) {
          reqLogger.error("Token fetch failed", error as Error);
        }
      }

      const newHeaders = new Headers(req.headers);
      if (token) newHeaders.set("x-token", token);
      newHeaders.set("x-project-slug", projectSlug || "");
      newHeaders.set("x-environment", scope);
      newHeaders.set("x-forwarded-host", host);
      newHeaders.delete("host");

      injectContext(newHeaders);

      const rendererUrl = new URL(url.pathname + url.search, RENDERER_URL);
      const response = await fetch(rendererUrl.toString(), {
        method: req.method,
        headers: newHeaders,
        body: req.body,
        redirect: "manual",
      });

      const durationMs = Math.round(performance.now() - startTime);
      reqLogger.info("Request completed", { status: response.status, durationMs });

      endSpan(spanInfo?.span, response.status);

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (error) {
      const durationMs = Math.round(performance.now() - startTime);
      proxyLogger.error("Error forwarding request", { path: url.pathname, durationMs }, error as Error);

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
  const stats = await tokenManager.getStats();
  return new Response(JSON.stringify(stats, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Route requests to appropriate handler.
 */
async function router(req: Request): Promise<Response> {
  const url = new URL(req.url);

  // Stats endpoint for monitoring
  if (url.pathname === "/_proxy/stats") {
    return handleStats();
  }

  // Health check
  if (url.pathname === "/_proxy/health") {
    return new Response("OK", { status: 200 });
  }

  // Forward all other requests to renderer
  return handleRequest(req);
}

// Graceful shutdown
async function shutdown(): Promise<void> {
  proxyLogger.info("Shutting down");
  await tokenManager.close();
  await shutdownOTLP();
  proxyLogger.info("Closed cache connections");
  Deno.exit(0);
}

Deno.addSignalListener("SIGINT", shutdown);
Deno.addSignalListener("SIGTERM", shutdown);

// Initialize tracing and start server
await initializeOTLPWithApis();
validateConfig();

const cacheType = Deno.env.get("CACHE_TYPE") || "memory";
proxyLogger.info("Starting proxy server", {
  port: PORT,
  rendererUrl: RENDERER_URL,
  apiBaseUrl: config.apiBaseUrl,
  cacheType,
});

Deno.serve({ port: PORT }, router);
