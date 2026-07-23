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
 * - LOCAL_PROJECTS: JSON map of slug to filesystem path (for dev)
 * - CACHE_TYPE: "memory" (default) or "redis"
 * - REDIS_URL: Redis connection URL (required if CACHE_TYPE=redis)
 * - VERYFRONT_PROXY_EXPECTED_REPLICAS: Minimum proxy replicas required to acknowledge routing changes
 * - VERYFRONT_PROXY_ROUTING_INVALIDATION_SECRET: HMAC secret for Redis routing events and acknowledgements
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
  createUpstreamWebSocketUrl,
  getClientWebSocketErrorLogLevel,
  getServerWebSocketErrorLogLevel,
} from "./websocket-bridge.ts";
import { register } from "../extensions/contracts.ts";
import { importFirstPartyExtensionModule } from "#veryfront/extensions/first-party-import.ts";
import { ENV_VAR_MISSING, INITIALIZATION_ERROR } from "#veryfront/errors";
import type { AuthProvider } from "#veryfront/extensions/auth/index.ts";
import {
  endSpan,
  extractContext,
  initializeOTLPWithApis,
  injectContext,
  ProxySpanNames,
  sanitizeProxySpanUrl,
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
import {
  createLinkedRequestTimeout,
  type ProxyRequestLifecycle,
  runProxyRequestLifecycle,
  waitForAbortableDelay,
} from "./request-lifecycle.ts";
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
import {
  removeStickyCookieFromPublicCacheableResponse,
  stripHopByHopHeaders,
} from "./response-headers.ts";
import {
  closeProxyServerWithin,
  createProxyDrainingResponse,
  parseProxyDrainTimeoutMs,
  ProxyRequestDrainTracker,
} from "./request-drain.ts";
import {
  handleProxyRoutingInvalidationRequest,
  PROXY_ROUTING_INVALIDATION_PATH,
} from "./routing-invalidation.ts";
import { startProxyRoutingInvalidationBus } from "./routing-invalidation-redis.ts";
import {
  parseHttpBaseUrl,
  parseIntegerSetting,
  parseLocalProjectsSetting,
  parseProxyBindingSetting,
} from "./env.ts";

type AuthJwtExtensionModule = {
  createAuthProvider: (options?: Record<string, unknown>) => AuthProvider;
};

function getLocalProjects(): Record<string, string> {
  return parseLocalProjectsSetting(getEnv("LOCAL_PROJECTS"));
}

// Configuration from environment variables
const apiClientId = getEnv("VERYFRONT_PROXY_API_CLIENT_ID") || "";
const apiClientSecret = getEnv("VERYFRONT_PROXY_API_CLIENT_SECRET") || "";

const config: ProxyConfig = {
  apiBaseUrl: parseHttpBaseUrl(
    "VERYFRONT_PROXY_API_BASE_URL",
    getEnv("VERYFRONT_PROXY_API_BASE_URL") || "https://api.veryfront.com",
  ),
  apiClientId,
  apiClientSecret,
  // Preview uses same service account (scopes determine access)
  previewApiClientId: apiClientId,
  previewApiClientSecret: apiClientSecret,
  localProjects: getLocalProjects(),
};

function resolveProxyBinding(): { hostname: string; port: number } {
  const proxyUrlRaw = getEnv("VERYFRONT_PROXY_URL");
  if (proxyUrlRaw) return parseProxyBindingSetting(proxyUrlRaw);

  const port = parseIntegerSetting("PORT", getEnv("PORT"), 8080, 1, 65_535);
  const hostname = getEnv("HOST") || "0.0.0.0";
  if (hostname.length === 0 || hostname.length > 253 || /[\s/?#@]/.test(hostname)) {
    throw new TypeError("HOST must be a valid hostname or IP address");
  }
  return { hostname, port };
}

const serverUrlFromEnv = getEnv("VERYFRONT_SERVER_URL");
// Fail closed in production: never silently forward to localhost.
if (!serverUrlFromEnv && isProduction()) {
  throw ENV_VAR_MISSING.create({
    detail:
      "VERYFRONT_SERVER_URL is required in production: refusing to fall back to http://localhost:3001.",
  });
}
const PRODUCTION_SERVER_URL = parseHttpBaseUrl(
  "VERYFRONT_SERVER_URL",
  serverUrlFromEnv || "http://localhost:3001",
);

const discoveryHost = getEnv("VERYFRONT_SERVER_DISCOVERY_HOST");
const staticTargets = getEnv("VERYFRONT_SERVER_TARGETS");
const rendererRouter = (discoveryHost || staticTargets)
  ? new RendererRouter(
    discoveryHost || "static-targets",
    PRODUCTION_SERVER_URL,
    parseIntegerSetting(
      "VERYFRONT_SERVER_DISCOVERY_INTERVAL_MS",
      getEnv("VERYFRONT_SERVER_DISCOVERY_INTERVAL_MS"),
      15_000,
      100,
      300_000,
    ),
  )
  : null;

// Dedicated server resolver: routes environments to their dedicated server if assigned
const apiInternalUrl = parseHttpBaseUrl(
  "VERYFRONT_API_INTERNAL_URL",
  getEnv("VERYFRONT_API_INTERNAL_URL") || config.apiBaseUrl,
);
const apiInternalUser = getEnv("VERYFRONT_API_INTERNAL_USER") || "";
const apiInternalPass = getEnv("VERYFRONT_API_INTERNAL_PASS") || "";
const serverResolver = new ServerResolver(apiInternalUrl, apiInternalUser, apiInternalPass);

const { hostname: HOST, port: PORT } = resolveProxyBinding();
const WS_CONNECT_TIMEOUT_MS = 30_000;
// Timeout for forwarding requests to production server (SSR can take time on cold start)
const DEFAULT_SERVER_REQUEST_TIMEOUT_MS = 90_000;
const DEFAULT_API_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS = 25_000;
const PROXY_SERVER_CLOSE_TIMEOUT_MS = 1_000;
const VERYFRONT_SERVER_REQUEST_TIMEOUT_MS = parseIntegerSetting(
  "VERYFRONT_SERVER_REQUEST_TIMEOUT_MS",
  getEnv("VERYFRONT_SERVER_REQUEST_TIMEOUT_MS"),
  DEFAULT_SERVER_REQUEST_TIMEOUT_MS,
  1,
  600_000,
);
// Retry configuration for transient connection errors
const DEFAULT_SERVER_RETRY_COUNT = 1;
const DEFAULT_SERVER_RETRY_DELAY_MS = 100;
const VERYFRONT_SERVER_RETRY_COUNT = parseIntegerSetting(
  "VERYFRONT_SERVER_RETRY_COUNT",
  getEnv("VERYFRONT_SERVER_RETRY_COUNT"),
  DEFAULT_SERVER_RETRY_COUNT,
  0,
  10,
);
const VERYFRONT_SERVER_RETRY_DELAY_MS = parseIntegerSetting(
  "VERYFRONT_SERVER_RETRY_DELAY_MS",
  getEnv("VERYFRONT_SERVER_RETRY_DELAY_MS"),
  DEFAULT_SERVER_RETRY_DELAY_MS,
  0,
  60_000,
);
const VERYFRONT_API_REQUEST_TIMEOUT_MS = parseIntegerSetting(
  "VERYFRONT_API_REQUEST_TIMEOUT_MS",
  getEnv("VERYFRONT_API_REQUEST_TIMEOUT_MS"),
  DEFAULT_API_REQUEST_TIMEOUT_MS,
  1,
  300_000,
);
const SHUTDOWN_DRAIN_TIMEOUT_MS = parseProxyDrainTimeoutMs(
  getEnv("SHUTDOWN_DRAIN_TIMEOUT_MS"),
  DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS,
);
const routingInvalidationSecret = getEnv("VERYFRONT_PROXY_ROUTING_INVALIDATION_SECRET") ?? "";
const routingInvalidationSecretBytes =
  new TextEncoder().encode(routingInvalidationSecret).byteLength;
const expectedReplicasRaw = getEnv("VERYFRONT_PROXY_EXPECTED_REPLICAS");
let expectedReplicas = 0;
if (expectedReplicasRaw !== undefined && expectedReplicasRaw.trim() !== "") {
  try {
    expectedReplicas = parseIntegerSetting(
      "VERYFRONT_PROXY_EXPECTED_REPLICAS",
      expectedReplicasRaw,
      1,
      1,
      10_000,
    );
  } catch {
    throw new Error("VERYFRONT_PROXY_EXPECTED_REPLICAS must be a positive integer");
  }
}
const hasValidExpectedReplicas = expectedReplicas > 0;
if (isProduction() && !hasValidExpectedReplicas) {
  throw new Error("VERYFRONT_PROXY_EXPECTED_REPLICAS must be a positive integer in production");
}
if (isProduction() && routingInvalidationSecretBytes < 32) {
  throw new Error(
    "VERYFRONT_PROXY_ROUTING_INVALIDATION_SECRET must contain at least 32 bytes in production",
  );
}
if (routingInvalidationSecretBytes > 65_536) {
  throw new Error("VERYFRONT_PROXY_ROUTING_INVALIDATION_SECRET exceeds the size limit");
}
const proxyRequestDrainTracker = new ProxyRequestDrainTracker();
let shuttingDown = false;

const { createAuthProvider } = await importFirstPartyExtensionModule<AuthJwtExtensionModule>(
  "ext-auth-jwt",
  "@veryfront/ext-auth-jwt",
).catch((error) => {
  throw INITIALIZATION_ERROR.create({
    detail:
      `The Veryfront proxy requires the ext-auth-jwt extension. In npm deployments install @veryfront/ext-auth-jwt alongside veryfront. ${
        error instanceof Error ? error.message : String(error)
      }`,
    cause: error,
  });
});
register("AuthProvider", createAuthProvider({}));

// Initialize cache and proxy handler
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
  expectedReplicas: hasValidExpectedReplicas ? expectedReplicas : undefined,
  integritySecret: routingInvalidationSecret,
  logger: routingInvalidationLogger,
  onInvalidate: proxyHandler.invalidateAndConfirmRoutingLookup,
}).catch((error) => {
  if (isProduction()) {
    throw new Error("Proxy routing invalidation bus failed to start", { cause: error });
  }
  proxyLogger.error(
    "Proxy routing invalidation bus failed; TTL recovery remains active",
    {},
    error instanceof Error ? error : new Error(String(error)),
  );
  return null;
});
if (isProduction() && !routingInvalidationBus) {
  throw new Error(
    "Proxy routing invalidation bus requires REDIS_URL and a valid VERYFRONT_PROXY_ROUTING_INVALIDATION_SECRET in production",
  );
}

// Validate configuration on startup
const missingCredentials = proxyHandler.validateConfig();
if (isProduction() && missingCredentials.length > 0) {
  throw ENV_VAR_MISSING.create({
    detail: `${missingCredentials.join(", ")} must be configured for the production proxy`,
  });
}
if (missingCredentials.length > 0) {
  proxyLogger.warn("Missing OAuth credentials", { missingCredentials });
  proxyLogger.warn("Remote project routes are unavailable until credentials are configured");
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

  const targetUrl = createUpstreamWebSocketUrl(
    PRODUCTION_SERVER_URL,
    url,
    projectSlug,
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
      targetPath: targetUrl.pathname,
    });

    try {
      serverSocket = new WebSocket(targetUrl.toString());
    } catch (error) {
      proxyLogger.error("[WebSocket] Failed to create server WebSocket", {
        error: error instanceof Error ? error.message : String(error),
        targetPath: targetUrl.pathname,
      });
      closeBridgePeer(clientSocket, 1011, "Failed to connect to server");
      return;
    }

    connectTimeoutId = setTimeout(() => {
      timedOut = true;
      proxyLogger.error("[WebSocket] Server connection timeout", {
        targetPath: targetUrl.pathname,
        timeoutMs: WS_CONNECT_TIMEOUT_MS,
      });
      closeBridgePeer(serverSocket, 1001, "Server connection timeout");
      closeBridgePeer(clientSocket, 1001, "Server connection timeout");
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
        targetPath: targetUrl.pathname,
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
      closeBridgePeer(clientSocket, event.code, event.reason);
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
    closeBridgePeer(serverSocket, 1000, "Client connection closed");
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
          stripHopByHopHeaders(newHeaders);
          if (ctx.token) newHeaders.set("x-token", ctx.token);
          newHeaders.set("x-project-slug", ctx.projectSlug || "");
          newHeaders.set("x-environment", ctx.environment);
          newHeaders.set("x-forwarded-host", ctx.host);
          newHeaders.set("x-forwarded-proto", url.protocol.replace(/:$/, ""));
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
            // Collapse leading slashes to prevent protocol-relative URL interpretation,
            // for example, treating "//cms/..." as the hostname "cms".
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
              const delayCompleted = await waitForAbortableDelay(
                VERYFRONT_SERVER_RETRY_DELAY_MS,
                req.signal,
              );
              markProxyServerTimingPhase(
                proxyTiming,
                "proxy.retry_delay",
                performance.now() - retryDelayStartedAt,
              );
              if (!delayCompleted) {
                const clientAbortError = new Error("Client request aborted during retry delay");
                lifecycle.end(499, clientAbortError);
                return withProxyTiming(
                  jsonErrorResponse(499, { error: "Client Closed Request" }),
                );
              }
            }

            const upstreamTimeout = createLinkedRequestTimeout(
              req.signal,
              VERYFRONT_SERVER_REQUEST_TIMEOUT_MS,
            );

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
                        signal: upstreamTimeout.signal,
                      }),
                    {
                      "http.method": req.method,
                      "http.url": sanitizeProxySpanUrl(serverUrl),
                      "http.host": serverUrl.host,
                      "proxy.target": "server",
                      "proxy.project_slug": ctx.projectSlug || "",
                      "proxy.timeout_ms": VERYFRONT_SERVER_REQUEST_TIMEOUT_MS,
                      "proxy.retry_attempt": attempt,
                    },
                  ),
              );

              upstreamTimeout.cleanup();
              const ms = Math.round(performance.now() - startTime);

              if (attempt > 0) {
                reqLogger.info(
                  `${response.status} ${req.method} ${url.pathname} (retry succeeded)`,
                  { ms, attempt },
                );
              } else {
                reqLogger.info(`${response.status} ${req.method} ${url.pathname}`, { ms });
              }

              const responseHeaders = new Headers(response.headers);
              stripHopByHopHeaders(responseHeaders);
              return withProxyTiming(
                removeStickyCookieFromPublicCacheableResponse(
                  new Response(response.body, {
                    status: response.status,
                    statusText: response.statusText,
                    headers: responseHeaders,
                  }),
                ),
              );
            } catch (error) {
              upstreamTimeout.cleanup();
              lastError = error as Error;

              if (upstreamTimeout.didTimeOut()) {
                const timeoutError = error instanceof Error
                  ? error
                  : new Error("Upstream request timed out");
                const ms = Math.round(performance.now() - startTime);
                proxyLogger.error(`${UPSTREAM_TIMEOUT_STATUS} ${req.method} ${url.pathname}`, {
                  ms,
                  timeoutMs: VERYFRONT_SERVER_REQUEST_TIMEOUT_MS,
                });
                lifecycle.end(UPSTREAM_TIMEOUT_STATUS, timeoutError);
                return withProxyTiming(
                  createUpstreamTimeoutResponse(VERYFRONT_SERVER_REQUEST_TIMEOUT_MS),
                );
              }

              if (req.signal.aborted) {
                const clientAbortError = error instanceof Error
                  ? error
                  : new Error("Client request aborted");
                lifecycle.end(499, clientAbortError);
                return withProxyTiming(
                  jsonErrorResponse(499, { error: "Client Closed Request" }),
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
                      dedicatedTarget: true,
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
      if (req.signal.aborted) {
        const clientAbortError = error instanceof Error
          ? error
          : new Error("Client request aborted");
        lifecycle.end(499, clientAbortError);
        return withProxyTiming(
          jsonErrorResponse(499, { error: "Client Closed Request" }),
        );
      }
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
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
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
  const apiTimeout = createLinkedRequestTimeout(req.signal, VERYFRONT_API_REQUEST_TIMEOUT_MS);

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
          redirect: "manual",
          signal: apiTimeout.signal,
        }),
      {
        "http.method": req.method,
        "http.url": sanitizeProxySpanUrl(apiUrlObj),
        "http.host": apiUrlObj.host,
        "proxy.target": "api",
        "proxy.api_path": apiPath,
      },
    );
    apiTimeout.cleanup();

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: {
        "Content-Type": response.headers.get("Content-Type") || "application/json",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    apiTimeout.cleanup();
    if (apiTimeout.didTimeOut()) {
      proxyLogger.error("API proxy request timed out", error as Error);
      return jsonErrorResponse(504, { error: "Gateway Timeout" });
    }
    if (req.signal.aborted) {
      return jsonErrorResponse(499, { error: "Client Closed Request" });
    }
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

  if (shuttingDown) return createProxyDrainingResponse();
  if (url.pathname === "/_proxy/health") {
    return Response.json(
      { service: "veryfront-proxy", status: "ok" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const requestId = crypto.randomUUID();
  proxyRequestDrainTracker.start(requestId, req.method, url.pathname);

  try {
    let response: Response;
    if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
      response = await handleWebSocketUpgrade(req, url);
    } else if (url.pathname === PROXY_ROUTING_INVALIDATION_PATH) {
      response = await handleProxyRoutingInvalidationRequest(req, {
        publisher: routingInvalidationBus,
      });
    } else if (url.pathname === "/_proxy/stats") {
      response = isProduction() || Object.keys(proxyHandler.localProjects).length === 0
        ? jsonErrorResponse(403, { error: "Forbidden" })
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
  let exitCode = 0;

  proxyLogger.info(`Received ${signal}, initiating graceful shutdown`, {
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

    await routingInvalidationBus?.close();

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
    exitCode = 1;
    proxyLogger.error("Error while shutting down proxy", error);
  } finally {
    exit(exitCode);
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
  hasRendererDiscovery: rendererRouter !== null,
});

// Start the HTTP server
await server.serve(router, { port: PORT, hostname: HOST });
