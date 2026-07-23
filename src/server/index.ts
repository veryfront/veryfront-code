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
import { cwd } from "#veryfront/platform/compat/process.ts";
import { bootstrapProd } from "./bootstrap.ts";
import { createVeryfrontHandler } from "./runtime-handler/index.ts";
import { addClient, getClient, removeClient } from "./handlers/preview/hmr-client-manager.ts";
import { handleHmrClientMessage } from "./handlers/preview/hmr-client-message.ts";
import { RateLimiter } from "#veryfront/modules/server/index.ts";
import { HMR_MAX_MESSAGES_PER_MINUTE, serverLogger } from "#veryfront/utils";
import { createNodeWebSocketUpgradeController } from "#veryfront/platform/adapters/runtime/node/http-server.ts";
import {
  isWebSocketUpgradeResponse,
  type RuntimeResponse,
} from "#veryfront/platform/adapters/base.ts";
import type {
  NodeIncomingMessage,
  NodeUpgradeSocket,
} from "#veryfront/platform/adapters/runtime/node/types.ts";
import { getSafeErrorName } from "./utils/error-name.ts";

/** Default server port when no port is specified */
const DEFAULT_SERVER_PORT = 3_000;
const HMR_CLOSE_GOING_AWAY = 1001;
const HMR_CLOSE_CONNECTION_FAILED = 1011;
const handlerLog = serverLogger.component("handler-lifecycle");

export { DevServer, startDevServer, startProductionServer };
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
  /** Override the host-derived environment in standalone mode. */
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
export type VeryfrontHandler = ((req: Request) => Promise<Response>) & {
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
  /** Release bootstrap, watcher, HMR, and other handler-owned resources. */
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
 * import { createHandler } from "veryfront"
 *
 * const app = new Hono()
 * const handler = await createHandler()
 * app.all("*", (c) => handler(c.req.raw))
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

function toNativeResponse(res: RuntimeResponse): Response {
  if (isWebSocketUpgradeResponse(res)) {
    throw new TypeError("WebSocket upgrades require the server upgrade handler");
  }
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

function createHandlerDisposer(
  actions: Array<() => void | Promise<void>>,
): () => Promise<void> {
  let disposePromise: Promise<void> | undefined;
  return () => {
    if (disposePromise) return disposePromise;
    disposePromise = (async () => {
      const failures: unknown[] = [];
      for (const action of actions) {
        try {
          await action();
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length > 0) {
        throw new AggregateError(failures, "Veryfront handler cleanup failed");
      }
    })();
    return disposePromise;
  };
}

async function cleanupHandlerCreationFailure(
  error: unknown,
  cleanup: () => void | Promise<void>,
): Promise<never> {
  try {
    await cleanup();
  } catch (cleanupError) {
    handlerLog.warn("Handler cleanup failed after creation failed", {
      errorName: getSafeErrorName(cleanupError),
    });
  }
  throw error;
}

/** Create a Veryfront request handler for development or production. */
export async function createHandler(
  options: { projectDir?: string; mode?: "development" | "production"; port?: number } = {},
): Promise<VeryfrontHandler> {
  const projectDir = options.projectDir ?? cwd();

  if (options.mode === "production") {
    const adapter = await runtime.get();
    const bootstrap = await bootstrapProd(projectDir, adapter);
    const dispose = createHandlerDisposer([
      async () => await bootstrap.dispose?.(),
    ]);
    try {
      const internalHandler = createVeryfrontHandler(projectDir, bootstrap.adapter, {
        projectDir,
        config: bootstrap.config,
      });
      await internalHandler.ready;
      const handler = async (req: Request) => toNativeResponse(await internalHandler(req));
      return Object.assign(handler, {
        upgrade: () => {},
        connectHMR: () => {},
        dispose,
      });
    } catch (error) {
      return await cleanupHandlerCreationFailure(error, dispose);
    }
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
  const fetch = async (req: Request) => toNativeResponse(await internalFetch(req));
  const hmrRateLimiter = new RateLimiter(HMR_MAX_MESSAGES_PER_MINUTE);
  const upgradedServers = new Map<
    object,
    {
      server: import("node:http").Server;
      controller: ReturnType<typeof createNodeWebSocketUpgradeController>;
      onUpgrade: (
        request: import("node:http").IncomingMessage,
        socket: import("node:stream").Duplex,
        head: Uint8Array,
      ) => void;
      onClose: () => void;
    }
  >();
  const connectedHMRDisposers = new Set<() => void>();
  let disposed = false;

  const upgrade = (server: unknown) => {
    if (typeof server !== "object" || server === null) {
      throw new TypeError("A Node HTTP server is required");
    }
    if (disposed) throw new TypeError("The Veryfront handler has been disposed");
    if (upgradedServers.has(server)) return;

    const httpServer = server as import("node:http").Server;
    const controller = createNodeWebSocketUpgradeController(
      internalFetch,
      "localhost",
      port,
    );
    const onUpgrade = (
      request: import("node:http").IncomingMessage,
      socket: import("node:stream").Duplex,
      head: Uint8Array,
    ) => {
      void controller
        .then((value) =>
          value.handle(
            request as unknown as NodeIncomingMessage,
            socket as unknown as NodeUpgradeSocket,
            head,
          )
        )
        .catch(() => socket.destroy());
    };
    const onClose = () => {
      upgradedServers.delete(server);
      void controller.then((value) => value.close()).catch(() => {});
    };
    upgradedServers.set(server, { server: httpServer, controller, onUpgrade, onClose });
    httpServer.on("upgrade", onUpgrade);
    httpServer.once("close", onClose);
  };

  const connectHMR = (ws: WebSocket) => {
    if (disposed) throw new TypeError("The Veryfront handler has been disposed");
    const clientId = crypto.randomUUID();
    const accepted = addClient({
      id: clientId,
      socket: ws,
      connectedAt: Date.now(),
      lastActivity: Date.now(),
      projectDir,
    });
    if (!accepted) return;

    let cleanedUp = false;
    function onMessage(event: MessageEvent): void {
      const keepOpen = handleHmrClientMessage({
        socket: ws,
        data: event.data,
        rateLimiter: hmrRateLimiter,
        onActivity: () => {
          const client = getClient(clientId);
          if (client) client.lastActivity = Date.now();
        },
      });
      if (!keepOpen) cleanup();
    }
    function sendConnected(): void {
      try {
        ws.send(JSON.stringify({ type: "connected" }));
      } catch {
        closeAndCleanup(HMR_CLOSE_CONNECTION_FAILED, "Connection failed");
      }
    }
    function onError(): void {
      closeAndCleanup(HMR_CLOSE_CONNECTION_FAILED, "Connection failed");
    }
    function cleanup(): void {
      if (cleanedUp) return;
      cleanedUp = true;
      ws.removeEventListener("close", cleanup);
      ws.removeEventListener("error", onError);
      ws.removeEventListener("message", onMessage);
      ws.removeEventListener("open", sendConnected);
      hmrRateLimiter.cleanup(ws);
      removeClient(clientId);
      connectedHMRDisposers.delete(shutdown);
    }
    function closeAndCleanup(code: number, reason: string): void {
      try {
        if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) {
          ws.close(code, reason);
        }
      } finally {
        cleanup();
      }
    }
    function shutdown(): void {
      closeAndCleanup(HMR_CLOSE_GOING_AWAY, "Server shutting down");
    }

    connectedHMRDisposers.add(shutdown);
    ws.addEventListener("close", cleanup, { once: true });
    ws.addEventListener("error", onError, { once: true });
    ws.addEventListener("message", onMessage);

    if (ws.readyState === WebSocket.OPEN) sendConnected();
    else if (ws.readyState === WebSocket.CONNECTING) {
      ws.addEventListener("open", sendConnected, { once: true });
    } else cleanup();
  };

  const disposeHandler = createHandlerDisposer([
    async () => {
      const failures: unknown[] = [];
      for (const [key, registration] of upgradedServers) {
        upgradedServers.delete(key);
        registration.server.off("upgrade", registration.onUpgrade);
        registration.server.off("close", registration.onClose);
        try {
          await registration.controller.then((value) => value.close());
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length > 0) {
        throw new AggregateError(failures, "WebSocket upgrade cleanup failed");
      }
    },
    () => {
      const failures: unknown[] = [];
      for (const close of [...connectedHMRDisposers]) {
        try {
          close();
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length > 0) {
        throw new AggregateError(failures, "HMR client cleanup failed");
      }
    },
    () => devServer.stop(),
  ]);
  const dispose = () => {
    disposed = true;
    return disposeHandler();
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
