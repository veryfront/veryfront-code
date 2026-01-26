/**
 * HMR Server Module
 * Handles Hot Module Replacement and WebSocket connections
 */
import * as dntShim from "../../../_dnt.shims.js";


import {
  HMR_MAX_MESSAGE_SIZE_BYTES,
  HMR_MAX_MESSAGES_PER_MINUTE,
  HTTP_NOT_FOUND,
  HTTP_NOT_IMPLEMENTED,
  HTTP_SERVER_ERROR,
  serverLogger as logger,
} from "../../utils/index.js";
import { createError, toError } from "../../errors/veryfront-error.js";
import type { HMRServerOptions, HMRUpdate } from "./hmr-types.js";
import type { Server } from "../../platform/adapters/base.js";
import {
  closeAllConnections,
  RateLimiter,
  setupWebSocketHandlers,
} from "../../modules/server/index.js";
import { generateHMRRuntimeScript } from "./hmr/index.js";

// Re-export types for backward compatibility
export type { HMRServerOptions, HMRUpdate } from "./hmr-types.js";

/**
 * HMR Server - Orchestrates Hot Module Replacement functionality
 * Manages WebSocket connections, serves runtime script, and broadcasts updates
 */
export class HMRServer {
  private clients = new Set<WebSocket>();
  private server?: Server;
  private cachedRuntime?: string;
  private rateLimiter: RateLimiter;
  private readonly maxMessageSize: number;
  private abortController?: AbortController;

  constructor(private options: HMRServerOptions) {
    this.maxMessageSize = options.maxMessageSize ?? HMR_MAX_MESSAGE_SIZE_BYTES;
    this.rateLimiter = new RateLimiter(options.maxMessagesPerMinute ?? HMR_MAX_MESSAGES_PER_MINUTE);
  }

  /**
   * Start the HMR server
   * Sets up HTTP server with WebSocket upgrade and runtime script serving
   */
  start(): Promise<void> {
    if (!this.options.adapter) {
      throw toError(
        createError({
          type: "config",
          message: "HMR server requires a runtime adapter",
        }),
      );
    }

    const handler = (req: dntShim.Request): dntShim.Response => {
      const url = new URL(req.url);

      if (req.headers.get("upgrade") === "websocket") {
        if (!this.options.adapter?.server) {
          return new dntShim.Response("WebSocket not supported in this runtime", {
            status: HTTP_NOT_IMPLEMENTED,
          });
        }

        try {
          const { socket, response } = this.options.adapter.server.upgradeWebSocket(req);

          setupWebSocketHandlers(socket, {
            clients: this.clients,
            rateLimiter: this.rateLimiter,
            maxMessageSize: this.maxMessageSize,
            reactRefresh: this.options.reactRefresh,
          });

          return response;
        } catch (error) {
          logger.error("WebSocket upgrade failed", error);
          return new dntShim.Response("WebSocket upgrade failed", { status: HTTP_SERVER_ERROR });
        }
      }

      if (url.pathname === "/hmr-runtime.js") {
        return new dntShim.Response(this.getHMRRuntime(), {
          headers: {
            "content-type": "application/javascript",
            "cache-control": "no-cache",
          },
        });
      }

      if (url.pathname === "/react-refresh-runtime.js") {
        if (!this.options.reactRefresh) {
          return new dntShim.Response("React Refresh not enabled", { status: HTTP_NOT_FOUND });
        }

        return new dntShim.Response(this.getReactRefreshRuntime(), {
          headers: {
            "content-type": "application/javascript",
            "cache-control": "no-cache",
          },
        });
      }

      return new dntShim.Response("Not Found", { status: HTTP_NOT_FOUND });
    };

    const controller = new AbortController();
    const signal = this.options.signal ?? controller.signal;
    this.abortController = this.options.signal ? undefined : controller;

    const startPromise = this.options.adapter
      .serve(handler, {
        port: this.options.port,
        hostname: "0.0.0.0",
        signal,
        onListen: ({ port }: { port: number }) => {
          logger.debug(`HMR server running on port ${port}`);
        },
      })
      .then((server) => {
        this.server = server;
      });

    startPromise.catch((error) => {
      logger.error("HMR server failed to start", error);
    });

    return startPromise;
  }

  /**
   * Stop the HMR server gracefully
   * Closes all WebSocket connections and shuts down the HTTP server
   */
  async stop(): Promise<void> {
    try {
      this.abortController?.abort();

      await closeAllConnections(this.clients, this.rateLimiter);

      await this.server?.stop();

      logger.debug("HMR server stopped");
    } catch (error) {
      logger.debug("[HMRServer] Server shutdown failed", { error });
    }
  }

  /**
   * Send an update to all connected clients
   * @param update - The HMR update to broadcast
   */
  sendUpdate(update: HMRUpdate): void {
    const message = JSON.stringify(update);

    logger.debug("[HMRServer] sendUpdate called", {
      type: update.type,
      connectedClients: this.clients.size,
    });

    let sentCount = 0;
    for (const client of this.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      client.send(message);
      sentCount++;
    }

    logger.debug("[HMRServer] Update sent to clients", {
      sentCount,
      totalClients: this.clients.size,
    });
  }

  /**
   * Get the number of connected clients
   * @returns The count of active WebSocket connections
   */
  getConnectionCount(): number {
    return this.clients.size;
  }

  /**
   * Get the HMR runtime script
   * Uses cached version if available for better performance
   */
  private getHMRRuntime(): string {
    this.cachedRuntime ??= generateHMRRuntimeScript({
      port: this.options.port,
      reactRefresh: this.options.reactRefresh,
    });

    return this.cachedRuntime;
  }

  /**
   * Get the React Refresh runtime script
   * Provides React Fast Refresh support for hot reloading
   */
  private getReactRefreshRuntime(): string {
    return `// React Refresh Runtime
window.__REACT_REFRESH_RUNTIME__ = true;
console.log('[React Refresh] Runtime loaded');`;
  }
}
