/**
 * Server Module Public API
 *
 * This module exports the public interface for the Veryfront server.
 * For routing utilities, import from "#veryfront/routing" directly.
 * For observability utilities, import from "#veryfront/observability" directly.
 *
 * @module server
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
import { bootstrapProd } from "./bootstrap.ts";
import { createVeryfrontHandler } from "./runtime-handler/index.ts";
import { addClient, getClient, removeClient } from "./handlers/preview/hmr-client-manager.ts";
import { RateLimiter } from "#veryfront/modules/server/index.ts";
import {
  HMR_CLOSE_MESSAGE_TOO_LARGE,
  HMR_CLOSE_RATE_LIMIT,
  HMR_MAX_MESSAGE_SIZE_BYTES,
  HMR_MAX_MESSAGES_PER_MINUTE,
  serverLogger,
} from "#veryfront/utils";

export { DevServer, startDevServer, startProductionServer };
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
export type { BuildOptions, BuildStats } from "./build-types.ts";

const serverApiLog = serverLogger.component("server-api");

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

export interface StartDevModeOptions extends BaseServerOptions {
  mode?: "development";
  /** @deprecated Ignored: HMR now uses /_ws on the main server port. */
  hmrPort?: number;
  moduleServerPort?: number;
  enableHMR?: boolean;
  enableFastRefresh?: boolean;
  fileWatcherDebounceMs?: number;
}

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

function getWebSocketMessageSize(data: unknown): number {
  if (typeof data === "string") return data.length;
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  if (data instanceof Blob) return data.size;
  return 0;
}

export async function createHandler(
  options: { projectDir?: string; mode?: "development" | "production"; port?: number } = {},
): Promise<VeryfrontHandler> {
  const projectDir = options.projectDir ?? process.cwd();

  if (options.mode === "production") {
    const adapter = await runtime.get();
    const bootstrap = await bootstrapProd(projectDir, adapter);
    const internalHandler = createVeryfrontHandler(projectDir, bootstrap.adapter, { projectDir });
    const handler = async (req: Request) => toNativeResponse(await internalHandler(req));
    return Object.assign(handler, { upgrade: () => {}, connectHMR: () => {} });
  }

  // Development mode (default) — includes file watching, HMR, cache invalidation
  const port = options.port ?? 3000;
  const devServer = new DevServer({
    port,
    projectDir,
    enableHMR: true,
    enableFastRefresh: true,
    handlerOnly: true,
  });
  await devServer.start();

  // ReloadNotifier subscription for HMR broadcast is now handled eagerly
  // inside DevServer.start() — no additional subscription needed here.

  const internalFetch = devServer.handler;
  const fetch = async (req: Request) => toNativeResponse(await internalFetch(req));
  const hmrRateLimiter = new RateLimiter(HMR_MAX_MESSAGES_PER_MINUTE);

  const upgrade = (server: unknown) => {
    const httpServer = server as import("node:http").Server;
    let wsServer: import("ws").WebSocketServer | null = null;

    httpServer.on("upgrade", async (request, socket, head) => {
      try {
        const { WebSocketServer } = await import("ws");
        if (!wsServer) wsServer = new WebSocketServer({ noServer: true });

        const key = request.headers["sec-websocket-key"];
        const requestId = typeof key === "string" ? key : Array.isArray(key) ? key[0] ?? "" : "";

        // Run request through handler pipeline so HMRHandler registers the WebSocket client
        const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
        const headersRecord: Record<string, string> = {};
        for (const [key, value] of Object.entries(request.headers)) {
          if (typeof value === "string") headersRecord[key] = value;
          else if (Array.isArray(value)) headersRecord[key] = value[0] ?? "";
        }
        await fetch(new Request(url.toString(), { method: "GET", headers: headersRecord }));

        // Complete transport-level WebSocket upgrade
        const { resolveWebSocketUpgrade } = await import(
          "#veryfront/platform/adapters/runtime/node/http-server.ts"
        );

        const server = wsServer;
        server.handleUpgrade(request, socket, head, (ws: import("ws").WebSocket) => {
          resolveWebSocketUpgrade(requestId, ws);
          server.emit("connection", ws, request);
        });
      } catch (_error) {
        socket.destroy();
      }
    });
  };

  const connectHMR = (ws: WebSocket) => {
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
      const messageSize = getWebSocketMessageSize(event.data);
      if (messageSize > HMR_MAX_MESSAGE_SIZE_BYTES) {
        try {
          ws.close(HMR_CLOSE_MESSAGE_TOO_LARGE, "Message too large");
        } catch (_) {
          /* expected: socket may already be closed */
        }
        return;
      }

      if (!hmrRateLimiter.check(ws)) {
        try {
          ws.close(HMR_CLOSE_RATE_LIMIT, "Rate limit exceeded");
        } catch (_) {
          /* expected: socket may already be closed */
        }
        return;
      }

      const client = getClient(clientId);
      if (client) client.lastActivity = Date.now();

      if (typeof event.data !== "string") return;

      try {
        const data = JSON.parse(event.data);
        if (data?.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
        }
      } catch (_) {
        /* expected: ignore malformed JSON from client */
      }
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

  return Object.assign(fetch, { upgrade, connectHMR });
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
export function toNodeHandler(
  handler: (req: Request) => Promise<Response> | Response,
): (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void {
  return async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === "string") headers[key] = value;
        else if (Array.isArray(value)) headers[key] = value[0] ?? "";
      }
      const method = req.method ?? "GET";
      const body = method === "GET" || method === "HEAD" ? null : req;
      const init: RequestInit & { duplex?: string } = {
        method,
        headers,
        body: body as BodyInit | null,
      };
      if (body) init.duplex = "half";

      const response = await handler(new Request(url.toString(), init));

      if (response.status === 101) return;
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) {
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      }
      res.end();
    } catch (error) {
      serverLogger.debug("toNodeHandler request failed", { error });
      res.writeHead(500);
      res.end("Internal Server Error");
    }
  };
}

/**
 * Start a Veryfront server in development or production mode.
 *
 * This is the primary entry point for running a Veryfront server.
 * Defaults to development mode when `mode` is not specified.
 */
export async function startServer(
  options: StartServerOptions = {},
): Promise<VeryfrontServer> {
  const projectDir = options.projectDir ?? process.cwd();
  const port = options.port ?? 3000;
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
  if ("hmrPort" in options && options.hmrPort !== undefined) {
    serverApiLog.warn(
      "`hmrPort` is deprecated and ignored. HMR now uses /_ws on the main server port.",
      { hmrPort: options.hmrPort, serverPort: port },
    );
  }

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
// Import from "#veryfront/routing" for Route, RouteMatch, DynamicRouter, etc.
// Import from "#veryfront/observability" for tracing and metrics utilities.
