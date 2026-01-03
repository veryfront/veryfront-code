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
 */

import { TokenManager, type TokenScope } from "./token-manager.ts";
import { parseProjectDomain } from "../src/server/utils/domain-parser.ts";
import { createCacheFromEnv } from "./cache/index.ts";
import { initializeOTLP, shutdownOTLP } from "./tracing.ts";

// Configuration from environment variables
const config = {
  apiBaseUrl: Deno.env.get("VERYFRONT_API_BASE_URL") || "http://api.lvh.me:4000",
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
    console.warn(`[Proxy] Warning: Missing OAuth credentials: ${missing.join(", ")}`);
    console.warn("[Proxy] Proxy will forward requests without authentication");
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
 * Handle incoming requests: parse domain, get token, forward to renderer.
 */
async function handleRequest(req: Request): Promise<Response> {
  const startTime = performance.now();
  const host = req.headers.get("host") || "";
  const url = new URL(req.url);

  try {
    // Parse domain to extract project slug and environment
    const parsed = parseProjectDomain(host);
    const scope = getScope(parsed.environment);
    const projectSlug = parsed.slug || undefined;

    console.log(
      `[Proxy] ${req.method} ${url.pathname} -> ${scope} (project: ${projectSlug || "none"})`,
    );

    // Get OAuth token for this scope + project
    let token = "";
    if (config.clientId && config.clientSecret) {
      try {
        token = await tokenManager.getToken(scope, projectSlug);
      } catch (error) {
        console.error("[Proxy] Token fetch failed:", error);
        // Continue without token - renderer may have fallback
      }
    }

    // Create new headers with authentication
    const newHeaders = new Headers(req.headers);

    if (token) {
      newHeaders.set("x-token", token);
    }

    newHeaders.set("x-project-slug", projectSlug || "");
    newHeaders.set("x-environment", scope);
    newHeaders.set("x-forwarded-host", host);
    newHeaders.delete("host"); // Let renderer determine its own host

    // Build renderer URL
    const rendererUrl = new URL(url.pathname + url.search, RENDERER_URL);

    // Forward request to renderer
    const response = await fetch(rendererUrl.toString(), {
      method: req.method,
      headers: newHeaders,
      body: req.body,
      redirect: "manual",
    });

    const duration = (performance.now() - startTime).toFixed(0);
    console.log(`[Proxy] ${req.method} ${url.pathname} -> ${response.status} (${duration}ms)`);

    // Return response with original headers
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (error) {
    const duration = (performance.now() - startTime).toFixed(0);
    console.error(`[Proxy] Error forwarding request (${duration}ms):`, error);

    return new Response(
      JSON.stringify({
        error: "Proxy Error",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 502,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
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
  console.log("[Proxy] Shutting down...");
  await tokenManager.close();
  await shutdownOTLP();
  console.log("[Proxy] Closed cache connections");
  Deno.exit(0);
}

Deno.addSignalListener("SIGINT", shutdown);
Deno.addSignalListener("SIGTERM", shutdown);

// Initialize tracing and start server
await initializeOTLP();
validateConfig();

const cacheType = Deno.env.get("CACHE_TYPE") || "memory";
console.log(`[Proxy] Starting on port ${PORT}`);
console.log(`[Proxy] Forwarding to ${RENDERER_URL}`);
console.log(`[Proxy] API Base URL: ${config.apiBaseUrl}`);
console.log(`[Proxy] Cache type: ${cacheType}`);

Deno.serve({ port: PORT }, router);
