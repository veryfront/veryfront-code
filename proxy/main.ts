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
    "http://api.veryfront.dev:4000",
  clientId: Deno.env.get("OAUTH_CLIENT_ID") || "",
  clientSecret: Deno.env.get("OAUTH_CLIENT_SECRET") || "",
  previewClientId: Deno.env.get("OAUTH_PREVIEW_CLIENT_ID") || "",
  previewClientSecret: Deno.env.get("OAUTH_PREVIEW_CLIENT_SECRET") || "",
};

const RENDERER_URL = Deno.env.get("RENDERER_URL") || "http://localhost:3001";
const PORT = parseInt(Deno.env.get("PORT") || "8080");
const WS_CONNECT_TIMEOUT_MS = 30000;

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

function handleWebSocketUpgrade(req: Request): Response {
  const url = new URL(req.url);
  const host = req.headers.get("host") || "";
  const parsed = parseProjectDomain(host);
  // Use preview mode when studio_embed=true (Studio preview iframe)
  const isStudioEmbed = url.searchParams.get("studio_embed") === "true";
  const scope = isStudioEmbed ? "preview" : getScope(parsed.environment);
  const projectSlug = parsed.slug || undefined;

  proxyLogger.info("WebSocket upgrade request", {
    path: url.pathname,
    projectSlug,
    environment: scope,
  });

  const { socket: clientSocket, response } = Deno.upgradeWebSocket(req);

  const rendererWsUrl = RENDERER_URL.replace(/^http/, "ws");
  const targetUrl = new URL(`${rendererWsUrl}${url.pathname}${url.search}`);
  targetUrl.searchParams.set("x-project-slug", projectSlug || "");
  targetUrl.searchParams.set("x-environment", scope);

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
    proxyLogger.debug("Client WebSocket opened, connecting to renderer");

    rendererSocket = new WebSocket(targetUrl.toString());

    connectTimeoutId = setTimeout(() => {
      timedOut = true;
      proxyLogger.error("Renderer WebSocket connection timeout");
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
      proxyLogger.debug("Renderer WebSocket connected");
    };

    rendererSocket.onmessage = (event) => {
      if (clientSocket.readyState === WebSocket.OPEN) {
        clientSocket.send(event.data);
      }
    };

    rendererSocket.onerror = (error) => {
      clearConnectTimeout();
      proxyLogger.error("Renderer WebSocket error", { error });
    };

    rendererSocket.onclose = () => {
      clearConnectTimeout();
      proxyLogger.debug("Renderer WebSocket closed");
      if (clientSocket.readyState === WebSocket.OPEN) {
        clientSocket.close();
      }
    };
  };

  clientSocket.onmessage = (event) => {
    if (rendererSocket?.readyState === WebSocket.OPEN) {
      rendererSocket.send(event.data);
    }
  };

  clientSocket.onerror = (error) => {
    clearConnectTimeout();
    proxyLogger.error("Client WebSocket error", { error });
  };

  clientSocket.onclose = () => {
    clearConnectTimeout();
    proxyLogger.debug("Client WebSocket closed");
    if (rendererSocket?.readyState === WebSocket.OPEN) {
      rendererSocket.close();
    }
  };

  return response;
}

function handleRequest(req: Request): Promise<Response> {
  const startTime = performance.now();
  const host = req.headers.get("host") || "";
  const url = new URL(req.url);

  if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
    return Promise.resolve(handleWebSocketUpgrade(req));
  }

  const parentContext = extractContext(req.headers);
  const spanInfo = startServerSpan(req.method, url.pathname, parentContext);

  const execute = async (): Promise<Response> => {
    try {
      const parsed = parseProjectDomain(host);
      // Use preview mode when studio_embed=true (Studio preview iframe)
      // This ensures custom domains use draft content in Studio preview
      const isStudioEmbed = url.searchParams.get("studio_embed") === "true";
      const scope = isStudioEmbed ? "preview" : getScope(parsed.environment);
      const projectSlug = parsed.slug || undefined;

      const reqLogger = proxyLogger.child({
        project: projectSlug,
        env: scope,
        ...(isStudioEmbed && { studio: true }),
      });

      reqLogger.debug("Request received", {
        parsedEnvironment: parsed.environment,
        effectiveScope: scope,
      });

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

      const ms = Math.round(performance.now() - startTime);
      reqLogger.info(`${response.status} ${req.method} ${url.pathname}`, { ms });

      endSpan(spanInfo?.span, response.status);

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (error) {
      const ms = Math.round(performance.now() - startTime);
      proxyLogger.error(`502 ${req.method} ${url.pathname}`, { ms }, error as Error);

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

function router(req: Request): Promise<Response> {
  const url = new URL(req.url);

  if (url.pathname === "/_proxy/stats") {
    return handleStats();
  }

  if (url.pathname === "/_proxy/health") {
    return Promise.resolve(new Response("OK", { status: 200 }));
  }

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
proxyLogger.debug("Starting proxy server", {
  port: PORT,
  rendererUrl: RENDERER_URL,
  apiBaseUrl: config.apiBaseUrl,
  cacheType,
});

Deno.serve({ port: PORT, onListen: () => {} }, router);
