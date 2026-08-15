/**
 * Create and run Veryfront servers.
 *
 * @module server
 *
 * @example Composable service server
 * ```ts
 * import { createVeryfrontServer } from "veryfront/server";
 *
 * const server = createVeryfrontServer({
 *   modules: [{
 *     name: "agent",
 *     handle: (request) => new Response(`Handled ${request.url}`),
 *   }],
 * });
 *
 * await server.fetch(new Request("https://example.com/health"));
 * ```
 *
 * @see docs/deployment.md
 * @see docs/security.md
 */

import {
  DevServer,
  type DevServerHandler,
  type DevServerOptions,
  type FileWatcherMetrics,
  type RouteDirectory,
  startDevServer,
} from "./dev-server.ts";
import {
  type DiscoveryOptions,
  type ServerHandle,
  startProductionServer,
  type StartProductionServerOptions,
} from "./production-server.ts";
import { runtime } from "#veryfront/platform/adapters/detect.ts";
import { isWebSocketUpgradeResponse } from "#veryfront/platform/adapters/base.ts";
import { recordHandlerRequestPeer } from "#veryfront/platform/adapters/runtime/shared/request-peer.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";
import { bootstrapProd } from "./bootstrap.ts";
import { createVeryfrontHandler } from "./runtime-handler/index.ts";
import { addClient, getClient, removeClient } from "./handlers/preview/hmr-client-manager.ts";
import { handleHmrClientMessage } from "./handlers/preview/hmr-client-message.ts";
import { RateLimiter } from "#veryfront/modules/server/index.ts";
import { HMR_MAX_MESSAGES_PER_MINUTE } from "#veryfront/utils";
import {
  captureNodeWebSocketServer,
  NODE_WEBSOCKET_SERVER_PROVIDER_MISSING_MESSAGE,
  type NodeWebSocketConnection,
  type NodeWebSocketServer,
} from "#veryfront/extensions/websocket";
import { type NodeUpgradeEventSource, NodeUpgradeLifecycle } from "./node-upgrade-lifecycle.ts";

/** Default server port when no port is specified */
const DEFAULT_SERVER_PORT = 3_000;

export { DevServer, type DevServerHandler, startDevServer, startProductionServer };
export {
  gracefullyShutdownProductionServer,
  type GracefulProductionShutdownOptions,
} from "./graceful-shutdown.ts";
export {
  createVeryfrontServer,
  type CreateVeryfrontServerOptions,
  type NodeVeryfrontServiceServer,
  startNodeVeryfrontServer,
  type StartNodeVeryfrontServerOptions,
  startVeryfrontServer,
  type StartVeryfrontServerOptions,
  type VeryfrontServiceServer,
  type VeryfrontServiceServerFetch,
  type VeryfrontServiceServerLogger,
  type VeryfrontServiceServerModule,
  type VeryfrontServiceServerModuleResponse,
  type VeryfrontServiceServerRuntime,
  type VeryfrontServiceServerRuntimeKind,
} from "./service-server.ts";
export type {
  DevServerOptions,
  DiscoveryOptions,
  FileWatcherMetrics,
  RouteDirectory,
  ServerHandle,
  StartProductionServerOptions,
};
import { ReloadNotifier } from "./reload-notifier.ts";
export { ReloadNotifier };
export { RouteDiscovery } from "./dev-server/route-discovery.ts";
export type { BuildOptions, BuildStats } from "./build-types.ts";
export { defaultDistributedCacheInitializers } from "./distributed-cache-initializers.ts";
export {
  HOSTED_ENVIRONMENT_NAMES,
  type HostedEnvironmentName,
  isHostedEnvironmentName,
  parseProjectDomain,
} from "./utils/domain-parser.ts";

/** Shared options for both development and production server modes. */
interface BaseServerOptions {
  /** Project root directory. Defaults to process.cwd(). */
  projectDir?: string;
  port?: number;
  /** 0.0.0.0 = all interfaces, 127.0.0.1 = localhost only */
  bindAddress?: string;
  signal?: AbortSignal;
  /** Default project slug when not provided via proxy headers (for tests/local mode) */
  defaultProjectSlug?: string;
  /** Default project ID when not provided via proxy headers (for tests/local mode) */
  defaultProjectId?: string;
  /**
   * Optional request interceptor for combined mode.
   * Transforms requests before they're processed by the core request handler.
   */
  requestInterceptor?: (req: Request) => Request | Promise<Request>;
}

/** Options accepted by start dev mode. */
export interface StartDevModeOptions extends BaseServerOptions {
  mode?: "development";
  moduleServerPort?: number;
  enableHMR?: boolean;
  enableFastRefresh?: boolean;
  fileWatcherDebounceMs?: number;
}

/** Options accepted by start production mode. */
export interface StartProductionModeOptions extends BaseServerOptions {
  mode?: "production";
  /** When true, expose additional debug logging. */
  debug?: boolean;
  /** Default environment for standalone mode (preview or production). Defaults to preview for safety. */
  defaultEnvironment?: "preview" | "production";
  /** Discovery configuration for AI primitives. Runs discoverAll() before serving. */
  discoveryConfig?: DiscoveryOptions;
  /** Map of local project slugs to their filesystem paths. */
  localProjects?: Record<string, string>;
}

/**
 * Server options. Defaults to development mode with HMR.
 * Set `mode: "production"` for a production server.
 */
export type StartServerOptions = StartDevModeOptions | StartProductionModeOptions;

/** Running server instance with lifecycle controls. */
export interface VeryfrontServer {
  /** Resolves when the server is ready to accept requests. */
  ready: Promise<void>;
  /** Gracefully stop the server. */
  stop: () => Promise<void>;
  /** The port the server is listening on. */
  port: number;
  /** The full URL the server is listening on. */
  url: string;
}

/** Web API request handler with WebSocket upgrade and HMR helpers. */
export type VeryfrontHandler = ((req: Request, nativeContext?: unknown) => Promise<Response>) & {
  /**
   * Attach WebSocket upgrade handling to a Node.js HTTP server.
   * Required for HMR live reload when using an external server like Hono, Express, etc.
   */
  upgrade: (server: unknown) => void;
  /**
   * Connect an external WebSocket to the HMR live reload system.
   * Use this for runtimes that manage WebSocket upgrades natively (e.g. Bun/Elysia)
   * instead of `handler.upgrade(server)`.
   */
  connectHMR: (ws: WebSocket) => void;
  /** Release upgrade listeners, sockets, and bootstrap-owned resources. */
  dispose: () => Promise<void>;
};

/**
 * Create a Veryfront request handler for use with any HTTP framework.
 *
 * Defaults to development mode with file watching and live reload.
 *
 * @example
 * ```ts
 * import { Hono } from "hono"
 * import { serve } from "@hono/node-server"
 * import type { HttpBindings } from "@hono/node-server"
 * import { createHandler } from "veryfront"
 *
 * const app = new Hono<{ Bindings: HttpBindings }>()
 * const handler = await createHandler()
 * app.all("*", (c) => handler(c.req.raw, c.env.incoming))
 * const server = serve({ fetch: app.fetch, port: 3000 })
 * handler.upgrade(server)
 * ```
 */
// Ensure responses use the native global Response class.
// The DNT (Deno-to-Node) build replaces all `Response` and `globalThis` references
// with an undici polyfill, which breaks `instanceof Response` checks in frameworks
// like h3. We use Function constructor to access the real global scope directly.
// eslint-disable-next-line no-new-func
const _nativeGlobal = new Function("return this")() as typeof globalThis;
const _NativeResponse: typeof Response = _nativeGlobal.Response;

function toNativeResponse(res: Response): Response {
  if (res instanceof _NativeResponse) return res;
  // TS narrows to `never` after the instanceof check because it can't see the
  // runtime class divergence between DNT's polyfill Response and native Response.
  const src = res as unknown as Response;
  return new _NativeResponse(src.body, {
    status: src.status,
    statusText: src.statusText,
    headers: src.headers,
  });
}

function createRetryableHandlerDisposer(
  run: () => void | Promise<void>,
): () => Promise<void> {
  let completed: Promise<void> | undefined;
  let inFlight: Promise<void> | undefined;
  return () => {
    if (completed) return completed;
    if (inFlight) return inFlight;
    const attempt = Promise.resolve().then(run);
    inFlight = attempt;
    void attempt.then(
      () => {
        if (inFlight === attempt) {
          completed = attempt;
          inFlight = undefined;
        }
      },
      () => {
        if (inFlight === attempt) inFlight = undefined;
      },
    );
    return attempt;
  };
}

/** Create a Veryfront request handler for development or production. */
export async function createHandler(
  options: { projectDir?: string; mode?: "development" | "production"; port?: number } = {},
): Promise<VeryfrontHandler> {
  const projectDir = options.projectDir ?? cwd();

  if (options.mode === "production") {
    const adapter = await runtime.get();
    const bootstrap = await bootstrapProd(projectDir, adapter);
    const internalHandler = createVeryfrontHandler(projectDir, bootstrap.adapter, { projectDir });
    const handler = async (req: Request, info?: unknown) => {
      recordHandlerRequestPeer(req, info);
      return toNativeResponse(await internalHandler(req));
    };
    const dispose = createRetryableHandlerDisposer(async () => {
      await bootstrap.dispose?.();
    });
    return Object.assign(handler, {
      upgrade: () => {},
      connectHMR: () => {},
      dispose,
    });
  }

  // Development mode (default), includes file watching, HMR, cache invalidation
  const port = options.port ?? DEFAULT_SERVER_PORT;
  const devServer = new DevServer({
    port,
    projectDir,
    enableHMR: true,
    enableFastRefresh: true,
    handlerOnly: true,
  });
  await devServer.start();

  // ReloadNotifier subscription for HMR broadcast is now handled eagerly
  // inside DevServer.start(), no additional subscription needed here.

  const internalFetch = devServer.handler;
  const nodeWebSocketServerProvider = devServer.nodeWebSocketServerProvider;
  let disposalStarted = false;
  const fetch = async (req: Request, info?: unknown) => {
    if (disposalStarted) {
      return new _NativeResponse("Handler is shutting down", {
        status: 503,
        headers: { "cache-control": "no-store" },
      });
    }
    return toNativeResponse(await internalFetch(req, info));
  };
  const hmrRateLimiter = new RateLimiter(HMR_MAX_MESSAGES_PER_MINUTE);
  const nodeUpgradeLifecycle = new NodeUpgradeLifecycle();

  const upgrade = (server: unknown) => {
    if (disposalStarted) throw new Error("Veryfront handler is already shutting down");
    if (nodeWebSocketServerProvider === undefined) {
      throw new Error(NODE_WEBSOCKET_SERVER_PROVIDER_MISSING_MESSAGE);
    }
    const httpServer = server as import("node:http").Server;
    let wsServer: NodeWebSocketServer | null = null;
    let handshakeController:
      | import("#veryfront/platform/adapters/runtime/node/http-server.ts").NodeWebSocketHandshakeController
      | null = null;

    const upgradeListener = (
      request: import("node:http").IncomingMessage,
      socket: import("node:stream").Duplex,
      head: Uint8Array,
    ): void => {
      let releaseSocket: (() => void) | undefined;
      const requestAbort = new AbortController();
      let requestId = "";
      let rejectWebSocketUpgrade:
        | ((requestId: string, error: Error) => boolean)
        | undefined;
      let socketReleased = false;
      const releaseTrackedSocket = () => {
        if (socketReleased) return;
        socketReleased = true;
        socket.off("close", onSocketClose);
        handshakeController?.release(request);
        releaseSocket?.();
        releaseSocket = undefined;
      };
      const onSocketClose = () => {
        const error = new DOMException("WebSocket client disconnected", "AbortError");
        if (!requestAbort.signal.aborted) requestAbort.abort(error);
        if (requestId) rejectWebSocketUpgrade?.(requestId, error);
        releaseTrackedSocket();
      };
      try {
        releaseSocket = nodeUpgradeLifecycle.trackSocket(socket);
        socket.once("close", onSocketClose);
      } catch {
        socket.destroy();
        return;
      }
      void (async () => {
        try {
          if (nodeUpgradeLifecycle.isDisposed || requestAbort.signal.aborted) {
            socket.destroy();
            releaseTrackedSocket();
            return;
          }

          const key = request.headers["sec-websocket-key"];
          const webSocketKey = typeof key === "string"
            ? key
            : Array.isArray(key)
            ? key[0] ?? ""
            : "";
          const upgradeRegistry = await import(
            "#veryfront/platform/adapters/runtime/node/http-server.ts"
          );
          requestId = crypto.randomUUID();
          rejectWebSocketUpgrade = upgradeRegistry.rejectWebSocketUpgrade;
          handshakeController ??= new upgradeRegistry.NodeWebSocketHandshakeController();

          // The application request pipeline is the authorization boundary.
          const url = new URL(
            request.url ?? "/",
            `http://${request.headers.host ?? "localhost"}`,
          );
          const headersRecord: Record<string, string> = {};
          for (const [headerName, value] of Object.entries(request.headers)) {
            if (typeof value === "string") headersRecord[headerName] = value;
            else if (Array.isArray(value)) headersRecord[headerName] = value[0] ?? "";
          }
          if (webSocketKey) headersRecord["sec-websocket-key"] = webSocketKey;
          headersRecord[upgradeRegistry.NODE_WEBSOCKET_UPGRADE_ID_HEADER] = requestId;
          const upgradeResponse = await internalFetch(
            new Request(url.toString(), {
              method: "GET",
              headers: headersRecord,
              signal: requestAbort.signal,
            }),
          );
          if (!isWebSocketUpgradeResponse(upgradeResponse)) {
            rejectWebSocketUpgrade(
              requestId,
              new Error("Request handler did not authorize a WebSocket upgrade"),
            );
            socket.destroy();
            releaseTrackedSocket();
            return;
          }
          if (!upgradeRegistry.hasPendingWebSocketUpgrade(requestId)) {
            socket.destroy();
            releaseTrackedSocket();
            return;
          }
          if (nodeUpgradeLifecycle.isDisposed || requestAbort.signal.aborted) {
            rejectWebSocketUpgrade(
              requestId,
              new Error("Veryfront handler stopped before WebSocket upgrade completed"),
            );
            socket.destroy();
            releaseTrackedSocket();
            return;
          }

          if (!wsServer) {
            const candidate = captureNodeWebSocketServer(
              nodeWebSocketServerProvider.createServer(
                handshakeController.serverOptions,
              ),
            );
            nodeUpgradeLifecycle.track(candidate);
            try {
              handshakeController.attach(candidate);
            } catch (error) {
              void nodeUpgradeLifecycle.retire(candidate).catch(() => undefined);
              throw error;
            }
            wsServer = candidate;
          }
          handshakeController.authorize(request, upgradeResponse);

          const ownedServer = wsServer;
          ownedServer.handleUpgrade(
            request,
            socket,
            head,
            (ws: NodeWebSocketConnection) => {
              releaseTrackedSocket();
              if (!upgradeRegistry.resolveWebSocketUpgrade(requestId, ws)) {
                if (ws.terminate) ws.terminate();
                else ws.close();
                return;
              }
              ownedServer.emit("connection", ws, request);
            },
          );
        } catch (error) {
          if (requestId) {
            rejectWebSocketUpgrade?.(
              requestId,
              error instanceof Error ? error : new Error(String(error)),
            );
          }
          socket.destroy();
          releaseTrackedSocket();
        }
      })();
    };

    nodeUpgradeLifecycle.attach(
      httpServer as unknown as NodeUpgradeEventSource,
      upgradeListener as unknown as (...args: unknown[]) => void,
    );
  };

  const connectHMR = (ws: WebSocket) => {
    if (disposalStarted) {
      ws.close(1012, "Veryfront handler is shutting down");
      return;
    }
    const clientId = crypto.randomUUID().slice(0, 8);
    addClient({
      id: clientId,
      socket: ws,
      connectedAt: Date.now(),
      lastActivity: Date.now(),
    });

    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      hmrRateLimiter.cleanup(ws);
      removeClient(clientId);
    };
    ws.addEventListener("close", cleanup);
    ws.addEventListener("error", cleanup);

    ws.addEventListener("message", (event) => {
      handleHmrClientMessage({
        socket: ws,
        data: event.data,
        rateLimiter: hmrRateLimiter,
        onActivity: () => {
          const client = getClient(clientId);
          if (client) client.lastActivity = Date.now();
        },
      });
    });

    const sendConnected = () => {
      try {
        ws.send(JSON.stringify({ type: "connected" }));
      } catch (_) {
        /* expected: socket may have closed immediately */
      }
    };

    if (ws.readyState === WebSocket.OPEN) sendConnected();
    else ws.addEventListener("open", sendConnected, { once: true });
  };

  const runDispose = createRetryableHandlerDisposer(async () => {
    await nodeUpgradeLifecycle.dispose();
    await devServer.stop();
  });
  const dispose = (): Promise<void> => {
    disposalStarted = true;
    return runDispose();
  };

  return Object.assign(fetch, { upgrade, connectHMR, dispose });
}

/**
 * Convert a Web API request handler into a Node.js HTTP request listener.
 *
 * @example
 * ```ts
 * import { createServer } from "node:http"
 * import { createHandler, toNodeHandler } from "veryfront"
 *
 * const handler = await createHandler()
 * const server = createServer(toNodeHandler(handler))
 * ```
 */
export { toNodeHandler } from "./node-handler.ts";

/**
 * Start a Veryfront server in development or production mode.
 *
 * This is the primary entry point for running a Veryfront server.
 * Defaults to development mode when `mode` is not specified.
 */
export async function startServer(
  options: StartServerOptions = {},
): Promise<VeryfrontServer> {
  const projectDir = options.projectDir ?? cwd();
  const port = options.port ?? DEFAULT_SERVER_PORT;
  const bindAddress = options.bindAddress ?? "localhost";

  if (options?.mode === "production") {
    const handle = await startProductionServer({
      projectDir,
      port,
      bindAddress: options.bindAddress,
      signal: options.signal,
      defaultProjectSlug: options.defaultProjectSlug,
      defaultProjectId: options.defaultProjectId,
      requestInterceptor: options.requestInterceptor,
      defaultEnvironment: options.defaultEnvironment,
      discoveryConfig: options.discoveryConfig,
      localProjects: options.localProjects,
      debug: options.debug,
    });
    return {
      ready: handle.ready,
      stop: () => handle.stop(),
      port,
      url: `http://${bindAddress}:${port}`,
    };
  }

  // Development mode (default)
  const devServer = await startDevServer({
    port,
    projectDir,
    bindAddress: options.bindAddress,
    moduleServerPort: "moduleServerPort" in options ? options.moduleServerPort : undefined,
    enableHMR: ("enableHMR" in options ? options.enableHMR : undefined) ?? true,
    enableFastRefresh: ("enableFastRefresh" in options ? options.enableFastRefresh : undefined) ??
      true,
    fileWatcherDebounceMs: "fileWatcherDebounceMs" in options
      ? options.fileWatcherDebounceMs
      : undefined,
    signal: options.signal,
    requestInterceptor: options.requestInterceptor,
    defaultProjectSlug: options.defaultProjectSlug,
    defaultProjectId: options.defaultProjectId,
  });
  return {
    ready: devServer.ready,
    stop: () => devServer.stop(),
    port,
    url: `http://${bindAddress}:${port}`,
  };
}

// Note: Wildcard re-exports removed to prevent circular dependency risks.
// Use public routing, middleware, and observability modules for those surfaces.
