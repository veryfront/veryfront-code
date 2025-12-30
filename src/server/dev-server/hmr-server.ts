/**
 * HMR Server Module
 * Handles Hot Module Replacement and WebSocket connections
 */

import { serverLogger as logger } from "@veryfront/utils";
import { HTTP_NOT_FOUND, HTTP_NOT_IMPLEMENTED, HTTP_SERVER_ERROR } from "@veryfront/utils";
import { HMR_MAX_MESSAGE_SIZE_BYTES, HMR_MAX_MESSAGES_PER_MINUTE } from "@veryfront/utils";
import { createError, toError } from "../../core/errors/veryfront-error.ts";
import type { HMRServerOptions, HMRUpdate } from "./hmr-types.ts";
import type { Server } from "../../platform/adapters/base.ts";
import {
  closeAllConnections,
  RateLimiter,
  setupWebSocketHandlers,
} from "@veryfront/modules/server/index.ts";
import { generateHMRRuntimeScript } from "./hmr/index.ts";

// Re-export types for backward compatibility
export type { HMRServerOptions, HMRUpdate } from "./hmr-types.ts";

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
    const _handler = (req: Request): Response => {
      const url = new URL(req.url);

      // WebSocket upgrade for HMR
      if (req.headers.get("upgrade") === "websocket") {
        // Use the runtime adapter's WebSocket upgrade method
        if (!this.options.adapter?.server) {
          return new Response("WebSocket not supported in this runtime", {
            status: HTTP_NOT_IMPLEMENTED,
          });
        }

        try {
          const { socket, response } = this.options.adapter.server.upgradeWebSocket(req);

          // Setup all WebSocket handlers using extracted module
          setupWebSocketHandlers(socket, {
            clients: this.clients,
            rateLimiter: this.rateLimiter,
            maxMessageSize: this.maxMessageSize,
            reactRefresh: this.options.reactRefresh,
          });

          return response;
        } catch (error) {
          logger.error("WebSocket upgrade failed", error);
          return new Response("WebSocket upgrade failed", { status: HTTP_SERVER_ERROR });
        }
      }

      // Serve HMR runtime script
      if (url.pathname === "/hmr-runtime.js") {
        return new Response(this.getHMRRuntime(), {
          headers: {
            "content-type": "application/javascript",
            "cache-control": "no-cache",
          },
        });
      }

      // Serve React Refresh runtime if enabled
      if (url.pathname === "/react-refresh-runtime.js") {
        if (!this.options.reactRefresh) {
          return new Response("React Refresh not enabled", { status: HTTP_NOT_FOUND });
        }
        return new Response(this.getReactRefreshRuntime(), {
          headers: {
            "content-type": "application/javascript",
            "cache-control": "no-cache",
          },
        });
      }

      return new Response("Not Found", { status: HTTP_NOT_FOUND });
    };

    // Ensure we have an adapter
    if (!this.options.adapter) {
      throw toError(createError({
        type: "config",
        message: "HMR server requires a runtime adapter",
      }));
    }

    // Create AbortController if no signal provided for fast shutdown
    const controller = new AbortController();
    const signal = this.options.signal || controller.signal;
    this.abortController = this.options.signal ? undefined : controller;

    // Use the adapter's serve method - works on any runtime (Deno, Node, Bun)
    const startPromise = this.options.adapter.serve(_handler, {
      port: this.options.port,
      signal,
      onListen: ({ port }: { port: number }) => {
        logger.debug(`HMR server running on port ${port}`);
      },
    }).then((server) => {
      this.server = server;
    });

    // Attach a handler to avoid unhandled rejections when callers forget to await
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
      // Use AbortController to trigger immediate shutdown
      if (this.abortController) {
        this.abortController.abort();
      }

      // Close all WebSocket connections gracefully using extracted module
      // This waits for the close handshake to complete (~100ms)
      await closeAllConnections(this.clients, this.rateLimiter);

      // Stop the HTTP server
      // Called AFTER WebSocket close handshake completes to avoid aborting connections
      if (this.server) {
        await this.server.stop();
      }

      logger.info("HMR server stopped");
    } catch (error) {
      // Server already stopped or shutdown failed - safe to ignore
      logger.debug("[HMRServer] Server shutdown failed", { error });
    }
  }

  /**
   * Send an update to all connected clients
   * @param update - The HMR update to broadcast
   */
  sendUpdate(update: HMRUpdate): void {
    const message = JSON.stringify(update);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
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
    if (this.cachedRuntime) {
      return this.cachedRuntime;
    }

    // Generate runtime script using extracted generator
    this.cachedRuntime = generateHMRRuntimeScript({
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
    // Minimal React Refresh runtime marker
    // In a real implementation, this would load the actual React Refresh runtime
    return `// React Refresh Runtime
window.__REACT_REFRESH_RUNTIME__ = true;
console.log('[React Refresh] Runtime loaded');`;
  }
}
