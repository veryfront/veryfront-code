/**
 * HMR Handler for Preview Mode
 *
 * Provides Hot Module Replacement WebSocket support for cloud preview environments.
 * Listens to ReloadNotifier events (triggered by API poke) and broadcasts to browsers.
 *
 * Only enabled when proxyEnvironment === "preview" (not production).
 */

import { serverLogger as logger } from "#veryfront/utils";
import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { ReloadNotifier } from "../../reload-notifier.ts";
import { RateLimiter, setupWebSocketHandlers } from "#veryfront/modules/server/index.ts";
import { HMR_MAX_MESSAGE_SIZE_BYTES, HMR_MAX_MESSAGES_PER_MINUTE } from "#veryfront/utils";

// Priority between auth (0) and cors (50)
const PRIORITY_HMR = 25 as HandlerPriority;

/** Client metadata for observability */
interface HMRClientInfo {
  id: string;
  socket: WebSocket;
  connectedAt: number;
  projectSlug?: string;
  userAgent?: string;
  lastActivity: number;
}

export class HMRHandler extends BaseHandler {
  private static clientsMap = new Map<string, HMRClientInfo>();
  private static clients = new Set<WebSocket>(); // Keep for backward compatibility with setupWebSocketHandlers
  private static rateLimiter = new RateLimiter(HMR_MAX_MESSAGES_PER_MINUTE);
  private static reloadUnsubscribe: (() => void) | null = null;
  private static initialized = false;
  private static metrics = {
    broadcastsSent: 0,
    messagesForwarded: 0,
    lastBroadcastTime: 0,
  };

  metadata: HandlerMetadata = {
    name: "HMRHandler",
    priority: PRIORITY_HMR,
    patterns: [{ pattern: "/_ws", exact: true }],
    // Enable in preview mode and development mode (not production)
    // proxyEnvironment is "preview" for {slug}.preview.* domains
    // mode is "development" for local dev server
    enabled: (ctx) => ctx.proxyEnvironment === "preview" || ctx.mode === "development",
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

    logger.debug("[HMRHandler] Initialized - listening for reload events");
  }

  /**
   * Broadcast HMR update to all connected clients
   * Sends individual update messages for each changed path when available
   * Falls back to reload message if no paths provided
   */
  private static broadcastUpdate(changedPaths?: string[]): void {
    const timestamp = Date.now();
    HMRHandler.metrics.broadcastsSent++;
    HMRHandler.metrics.lastBroadcastTime = timestamp;

    // If we have specific changed paths, send update messages for smart HMR
    // This allows the client to update only changed modules without full reload
    if (changedPaths?.length) {
      for (const path of changedPaths) {
        HMRHandler.broadcastMessage(JSON.stringify({ type: "update", path, timestamp }));
        HMRHandler.metrics.messagesForwarded++;
      }
      logger.debug("[HMRHandler] Broadcast update", {
        changedPaths: changedPaths.length,
        totalClients: HMRHandler.clientsMap.size,
        totalBroadcasts: HMRHandler.metrics.broadcastsSent,
      });
    } else {
      // No specific paths - fall back to full reload
      HMRHandler.broadcastMessage(JSON.stringify({ type: "reload", timestamp }));
      HMRHandler.metrics.messagesForwarded++;
      logger.debug("[HMRHandler] Broadcast reload (no paths)", {
        totalClients: HMRHandler.clientsMap.size,
        totalBroadcasts: HMRHandler.metrics.broadcastsSent,
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
    if (!this.shouldHandle(req, ctx)) {
      return Promise.resolve(this.continue());
    }

    // Initialize on first request
    HMRHandler.initialize();

    // Check for WebSocket upgrade
    if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      // Not a WebSocket request to /_ws - return debug info
      const clientDetails = Array.from(HMRHandler.clientsMap.values()).map((client) => ({
        id: client.id,
        connectedAt: client.connectedAt,
        projectSlug: client.projectSlug,
        lastActivity: client.lastActivity,
        connectionDurationMs: Date.now() - client.connectedAt,
      }));

      const response = new Response(
        JSON.stringify({
          status: "ok",
          clients: HMRHandler.clientsMap.size,
          clientDetails,
          metrics: {
            ...HMRHandler.metrics,
            reloadNotifierMetrics: ReloadNotifier.getMetrics(),
          },
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

      // Generate client ID for tracking
      const clientId = crypto.randomUUID().slice(0, 8);
      const clientInfo: HMRClientInfo = {
        id: clientId,
        socket,
        connectedAt: Date.now(),
        projectSlug: ctx.projectSlug,
        userAgent: req.headers.get("user-agent") ?? undefined,
        lastActivity: Date.now(),
      };

      // Track client in our map
      HMRHandler.clientsMap.set(clientId, clientInfo);

      // Setup WebSocket handlers using shared module
      setupWebSocketHandlers(socket, {
        clients: HMRHandler.clients,
        rateLimiter: HMRHandler.rateLimiter,
        maxMessageSize: HMR_MAX_MESSAGE_SIZE_BYTES,
        reactRefresh: false,
      });

      // Track when client disconnects
      socket.addEventListener("close", () => {
        const client = HMRHandler.clientsMap.get(clientId);
        if (client) {
          const connectionDurationMs = Date.now() - client.connectedAt;
          logger.debug("[HMRHandler] Client disconnected", {
            clientId,
            projectSlug: client.projectSlug,
            connectionDurationMs,
            totalClients: HMRHandler.clientsMap.size - 1,
          });
          HMRHandler.clientsMap.delete(clientId);
        }
      });

      // Update lastActivity on message
      socket.addEventListener("message", () => {
        const client = HMRHandler.clientsMap.get(clientId);
        if (client) {
          client.lastActivity = Date.now();
        }
      });

      logger.debug("[HMRHandler] Client connected", {
        clientId,
        projectSlug: ctx.projectSlug,
        totalClients: HMRHandler.clientsMap.size,
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
    return HMRHandler.clientsMap.size;
  }

  /**
   * Get metrics for monitoring
   */
  static getMetrics(): {
    clients: number;
    broadcastsSent: number;
    messagesForwarded: number;
    lastBroadcastTime: number;
  } {
    return {
      clients: HMRHandler.clientsMap.size,
      ...HMRHandler.metrics,
    };
  }

  /**
   * Cleanup resources on shutdown
   */
  static shutdown(): void {
    if (HMRHandler.reloadUnsubscribe) {
      HMRHandler.reloadUnsubscribe();
      HMRHandler.reloadUnsubscribe = null;
    }

    for (const [_id, client] of HMRHandler.clientsMap) {
      try {
        client.socket.close();
      } catch {
        // Ignore close errors
      }
    }
    HMRHandler.clientsMap.clear();
    HMRHandler.clients.clear();
    HMRHandler.initialized = false;

    logger.debug("[HMRHandler] Shutdown complete");
  }
}
