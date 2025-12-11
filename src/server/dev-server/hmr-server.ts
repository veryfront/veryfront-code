
import { serverLogger as logger } from "@veryfront/utils";
import { HTTP_NOT_FOUND, HTTP_NOT_IMPLEMENTED, HTTP_SERVER_ERROR } from "@veryfront/utils";
import { HMR_MAX_MESSAGE_SIZE_BYTES, HMR_MAX_MESSAGES_PER_MINUTE } from "@veryfront/utils";
import type { HMRServerOptions, HMRUpdate } from "./hmr-types.ts";
import type { Server } from "../../platform/adapters/base.ts";
import {
  closeAllConnections,
  RateLimiter,
  setupWebSocketHandlers,
} from "@veryfront/modules/server/index.ts";
import { generateHMRRuntimeScript } from "./hmr/index.ts";

export type { HMRServerOptions, HMRUpdate } from "./hmr-types.ts";

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

  start(): Promise<void> {
    const _handler = (req: Request): Response => {
      const url = new URL(req.url);

      if (req.headers.get("upgrade") === "websocket") {
        if (!this.options.adapter?.server) {
          return new Response("WebSocket not supported in this runtime", {
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
          return new Response("WebSocket upgrade failed", { status: HTTP_SERVER_ERROR });
        }
      }

      if (url.pathname === "/hmr-runtime.js") {
        return new Response(this.getHMRRuntime(), {
          headers: {
            "content-type": "application/javascript",
            "cache-control": "no-cache",
          },
        });
      }

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

    if (!this.options.adapter) {
      throw new Error("HMR server requires a runtime adapter");
    }

    const controller = new AbortController();
    const signal = this.options.signal || controller.signal;
    this.abortController = this.options.signal ? undefined : controller;

    const startPromise = this.options.adapter.serve(_handler, {
      port: this.options.port,
      signal,
      onListen: ({ port }: { port: number }) => {
        logger.debug(`HMR server running on port ${port}`);
      },
    }).then((server) => {
      this.server = server;
    });

    startPromise.catch((error) => {
      logger.error("HMR server failed to start", error);
    });

    return startPromise;
  }

  async stop(): Promise<void> {
    try {
      if (this.abortController) {
        this.abortController.abort();
      }

      await closeAllConnections(this.clients, this.rateLimiter);

      if (this.server) {
        await this.server.stop();
      }

      logger.info("HMR server stopped");
    } catch (error) {
      logger.debug("[HMRServer] Server shutdown failed", { error });
    }
  }

  sendUpdate(update: HMRUpdate): void {
    const message = JSON.stringify(update);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  getConnectionCount(): number {
    return this.clients.size;
  }

  private getHMRRuntime(): string {
    if (this.cachedRuntime) {
      return this.cachedRuntime;
    }

    this.cachedRuntime = generateHMRRuntimeScript({
      port: this.options.port,
      reactRefresh: this.options.reactRefresh,
    });

    return this.cachedRuntime;
  }

  private getReactRefreshRuntime(): string {
    return `// React Refresh Runtime
window.__REACT_REFRESH_RUNTIME__ = true;
console.log('[React Refresh] Runtime loaded');`;
  }
}
