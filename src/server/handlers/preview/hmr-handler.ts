/**
 * HMR Handler for Preview Mode
 *
 * Provides Hot Module Replacement WebSocket support for cloud preview environments.
 * Listens to ReloadNotifier events (triggered by API poke) and broadcasts to browsers.
 *
 * Only enabled when proxyEnvironment === "preview" (not production).
 */

import { serverLogger as logger } from "@veryfront/utils";
import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { ReloadNotifier } from "../../reload-notifier.ts";
import { setupWebSocketHandlers, RateLimiter } from "@veryfront/modules/server/index.ts";
import { HMR_MAX_MESSAGE_SIZE_BYTES, HMR_MAX_MESSAGES_PER_MINUTE } from "@veryfront/utils";

// Priority between auth (0) and cors (50)
const PRIORITY_HMR = 25 as HandlerPriority;

export class HMRHandler extends BaseHandler {
  private static clients = new Set<WebSocket>();
  private static rateLimiter = new RateLimiter(HMR_MAX_MESSAGES_PER_MINUTE);
  private static reloadUnsubscribe: (() => void) | null = null;
  private static initialized = false;

  metadata: HandlerMetadata = {
    name: "HMRHandler",
    priority: PRIORITY_HMR,
    patterns: [{ pattern: "/_ws", exact: true }],
    // Only enable in preview mode (not production)
    enabled: (ctx) => ctx.proxyEnvironment === "preview",
  };

  /**
   * Initialize HMR subscriptions (called once)
   */
  private static initialize(): void {
    if (HMRHandler.initialized) return;
    HMRHandler.initialized = true;

    // Subscribe to ReloadNotifier to broadcast HMR messages
    // When changedPaths are provided, send update messages for smart HMR
    // Otherwise, send reload message for full page refresh
    HMRHandler.reloadUnsubscribe = ReloadNotifier.subscribe((changedPaths) => {
      HMRHandler.broadcastUpdate(changedPaths);
    });

    logger.info("[HMRHandler] Initialized - listening for reload events");
  }

  /**
   * Broadcast HMR update to all connected clients
   * Sends individual update messages for each changed path when available
   * Falls back to reload message if no paths provided
   */
  private static broadcastUpdate(changedPaths?: string[]): void {
    const timestamp = Date.now();

    // If we have specific changed paths, send update messages for smart HMR
    // This allows the client to update only changed modules without full reload
    if (changedPaths && changedPaths.length > 0) {
      for (const path of changedPaths) {
        const message = JSON.stringify({
          type: "update",
          path,
          timestamp,
        });
        HMRHandler.broadcastMessage(message);
      }
      logger.info("[HMRHandler] Broadcast update", {
        changedPaths: changedPaths.length,
        totalClients: HMRHandler.clients.size,
      });
    } else {
      // No specific paths - fall back to full reload
      const message = JSON.stringify({
        type: "reload",
        timestamp,
      });
      HMRHandler.broadcastMessage(message);
      logger.info("[HMRHandler] Broadcast reload (no paths)", {
        totalClients: HMRHandler.clients.size,
      });
    }
  }

  /**
   * Send a message to all connected WebSocket clients
   */
  private static broadcastMessage(message: string): void {
    for (const client of HMRHandler.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(message);
        } catch (error) {
          logger.debug("[HMRHandler] Failed to send to client", { error });
        }
      }
    }
  }

  handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const url = new URL(req.url);

    if (!this.shouldHandle(req, ctx)) {
      return Promise.resolve(this.continue());
    }

    // Initialize on first request
    HMRHandler.initialize();

    // Check for WebSocket upgrade
    if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      // Not a WebSocket request to /_ws - return info
      const response = new Response(
        JSON.stringify({
          status: "ok",
          clients: HMRHandler.clients.size,
          message: "HMR WebSocket endpoint - connect via WebSocket",
        }),
        {
          headers: { "content-type": "application/json" },
        },
      );
      return Promise.resolve(this.respond(response));
    }

    // Upgrade to WebSocket
    if (!ctx.adapter?.server) {
      const response = new Response("WebSocket not supported", { status: 501 });
      return Promise.resolve(this.respond(response));
    }

    try {
      const { socket, response } = ctx.adapter.server.upgradeWebSocket(req);

      // Setup WebSocket handlers using shared module
      setupWebSocketHandlers(socket, {
        clients: HMRHandler.clients,
        rateLimiter: HMRHandler.rateLimiter,
        maxMessageSize: HMR_MAX_MESSAGE_SIZE_BYTES,
        reactRefresh: false,
      });

      logger.info("[HMRHandler] WebSocket client connected", {
        totalClients: HMRHandler.clients.size + 1,
      });

      return Promise.resolve(this.respond(response));
    } catch (error) {
      logger.error("[HMRHandler] WebSocket upgrade failed", { error });
      const response = new Response("WebSocket upgrade failed", { status: 500 });
      return Promise.resolve(this.respond(response));
    }
  }

  /**
   * Get the number of connected clients (for monitoring)
   */
  static getClientCount(): number {
    return HMRHandler.clients.size;
  }

  /**
   * Cleanup resources on shutdown
   */
  static shutdown(): void {
    if (HMRHandler.reloadUnsubscribe) {
      HMRHandler.reloadUnsubscribe();
      HMRHandler.reloadUnsubscribe = null;
    }

    for (const client of HMRHandler.clients) {
      try {
        client.close();
      } catch {
        // Ignore close errors
      }
    }
    HMRHandler.clients.clear();
    HMRHandler.initialized = false;

    logger.info("[HMRHandler] Shutdown complete");
  }
}
