import * as dntShim from "../../../../_dnt.shims.js";
import {
  HMR_MAX_MESSAGE_SIZE_BYTES,
  HMR_MAX_MESSAGES_PER_MINUTE,
  serverLogger as logger,
} from "../../../utils/index.js";
import { RateLimiter, setupWebSocketHandlers } from "../../../modules/server/index.js";
import { BaseHandler } from "../response/base.js";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.js";
import { ReloadNotifier } from "../../reload-notifier.js";
import { invalidateProjectCaches } from "../../context/cache-invalidation.js";

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

const PING_INTERVAL_MS = 45000;

export class HMRHandler extends BaseHandler {
  private static clientsMap = new Map<string, HMRClientInfo>();
  private static clients = new Set<WebSocket>(); // Keep for backward compatibility with setupWebSocketHandlers
  private static rateLimiter = new RateLimiter(HMR_MAX_MESSAGES_PER_MINUTE);
  private static reloadUnsubscribe: (() => void) | null = null;
  private static pingInterval: ReturnType<typeof dntShim.setInterval> | null = null;
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
    enabled: () => true,
  };

  private static initialize(): void {
    if (HMRHandler.initialized) return;
    HMRHandler.initialized = true;

    HMRHandler.reloadUnsubscribe = ReloadNotifier.subscribe((changedPaths, project) => {
      const projectSlug = project?.projectSlug ?? "preview";
      invalidateProjectCaches(projectSlug, changedPaths, {
        projectId: project?.projectId,
        environment: project?.environment,
        branchId: project?.branch ?? undefined,
      });
      HMRHandler.broadcastUpdate(changedPaths);
    });

    HMRHandler.pingInterval = dntShim.setInterval(() => {
      HMRHandler.sendPingToAllClients();
    }, PING_INTERVAL_MS);

    logger.debug("[HMRHandler] Initialized - listening for reload events", {
      pingIntervalMs: PING_INTERVAL_MS,
    });
  }

  private static sendPingToAllClients(): void {
    if (HMRHandler.clients.size === 0) return;

    const pingMessage = JSON.stringify({ type: "ping", timestamp: Date.now() });
    let sentCount = 0;

    for (const client of HMRHandler.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;

      try {
        client.send(pingMessage);
        sentCount++;
      } catch {
        // Client will be cleaned up on close event
      }
    }

    logger.debug("[HMRHandler] Sent ping to clients", {
      sentCount,
      totalClients: HMRHandler.clients.size,
    });
  }

  private static requiresFullReload(path: string): boolean {
    const ext = path.split(".").pop()?.toLowerCase();
    return ext === "mdx" || ext === "md" || path.includes("veryfront.config");
  }

  private static broadcastUpdate(changedPaths?: string[]): void {
    const timestamp = Date.now();
    HMRHandler.metrics.broadcastsSent++;
    HMRHandler.metrics.lastBroadcastTime = timestamp;

    logger.debug("[HMRHandler] broadcastUpdate called", {
      changedPaths,
      totalClients: HMRHandler.clientsMap.size,
    });

    const needsFullReload = !changedPaths?.length ||
      changedPaths.some((path) => HMRHandler.requiresFullReload(path));

    if (needsFullReload) {
      const message = JSON.stringify({ type: "reload", timestamp });
      logger.debug("[HMRHandler] Broadcasting full reload", {
        reason: changedPaths?.length ? "server-rendered content" : "no paths",
      });
      HMRHandler.broadcastMessage(message);
      HMRHandler.metrics.messagesForwarded++;
      return;
    }

    for (const path of changedPaths) {
      const message = JSON.stringify({ type: "update", path, timestamp });
      logger.debug("[HMRHandler] Broadcasting update message", { path });
      HMRHandler.broadcastMessage(message);
      HMRHandler.metrics.messagesForwarded++;
    }

    logger.debug("[HMRHandler] Broadcast update complete", {
      changedPaths: changedPaths.length,
      totalClients: HMRHandler.clientsMap.size,
    });
  }

  private static broadcastMessage(message: string): void {
    let sentCount = 0;
    let skippedCount = 0;

    for (const client of HMRHandler.clients) {
      if (client.readyState !== WebSocket.OPEN) {
        skippedCount++;
        logger.debug("[HMRHandler] Skipping client - not open", {
          readyState: client.readyState,
        });
        continue;
      }

      try {
        client.send(message);
        sentCount++;
      } catch (error) {
        logger.warn("[HMRHandler] Failed to send to client", { error });
      }
    }

    logger.debug("[HMRHandler] broadcastMessage complete", {
      sentCount,
      skippedCount,
      totalClients: HMRHandler.clients.size,
    });
  }

  handle(req: dntShim.Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (!this.shouldHandle(req, ctx)) return Promise.resolve(this.continue());

    const url = new URL(req.url);
    const queryEnv = url.searchParams.get("x-environment");
    const isPreviewMode = ctx.requestContext?.mode === "preview" || queryEnv === "preview";
    const isLocalDev = ctx.requestContext?.isLocalDev === true;

    if (!isPreviewMode && !isLocalDev) {
      logger.debug("[HMRHandler] Skipping - not preview or local dev", {
        mode: ctx.requestContext?.mode,
        queryEnv,
        isLocalDev,
      });
      return Promise.resolve(this.continue());
    }

    HMRHandler.initialize();

    if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      const now = Date.now();
      const clientDetails = Array.from(HMRHandler.clientsMap.values()).map((client) => ({
        id: client.id,
        connectedAt: client.connectedAt,
        projectSlug: client.projectSlug,
        lastActivity: client.lastActivity,
        connectionDurationMs: now - client.connectedAt,
      }));

      return Promise.resolve(
        this.respond(
          new dntShim.Response(
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
            { headers: { "content-type": "application/json" } },
          ),
        ),
      );
    }

    if (!ctx.adapter?.server) {
      return Promise.resolve(
        this.respond(new dntShim.Response("WebSocket not supported", { status: 501 })),
      );
    }

    try {
      const { socket, response } = ctx.adapter.server.upgradeWebSocket(req);

      const now = Date.now();
      const clientId = dntShim.crypto.randomUUID().slice(0, 8);
      HMRHandler.clientsMap.set(clientId, {
        id: clientId,
        socket,
        connectedAt: now,
        projectSlug: ctx.projectSlug,
        userAgent: req.headers.get("user-agent") ?? undefined,
        lastActivity: now,
      });

      setupWebSocketHandlers(socket, {
        clients: HMRHandler.clients,
        rateLimiter: HMRHandler.rateLimiter,
        maxMessageSize: HMR_MAX_MESSAGE_SIZE_BYTES,
        reactRefresh: false,
      });

      socket.addEventListener("close", () => {
        const client = HMRHandler.clientsMap.get(clientId);
        if (!client) return;

        logger.debug("[HMRHandler] Client disconnected", {
          clientId,
          projectSlug: client.projectSlug,
          connectionDurationMs: Date.now() - client.connectedAt,
          totalClients: HMRHandler.clientsMap.size - 1,
        });

        HMRHandler.clientsMap.delete(clientId);
      });

      socket.addEventListener("message", () => {
        const client = HMRHandler.clientsMap.get(clientId);
        if (client) client.lastActivity = Date.now();
      });

      logger.debug("[HMRHandler] Client connected", {
        clientId,
        projectSlug: ctx.projectSlug,
        totalClients: HMRHandler.clientsMap.size,
      });

      return Promise.resolve(this.respond(response));
    } catch (error) {
      logger.error("[HMRHandler] WebSocket upgrade failed", { error });
      return Promise.resolve(
        this.respond(new dntShim.Response("WebSocket upgrade failed", { status: 500 })),
      );
    }
  }

  static getClientCount(): number {
    return HMRHandler.clientsMap.size;
  }

  static getMetrics(): {
    clients: number;
    broadcastsSent: number;
    messagesForwarded: number;
    lastBroadcastTime: number;
  } {
    return { clients: HMRHandler.clientsMap.size, ...HMRHandler.metrics };
  }

  static shutdown(): void {
    HMRHandler.reloadUnsubscribe?.();
    HMRHandler.reloadUnsubscribe = null;

    if (HMRHandler.pingInterval) {
      clearInterval(HMRHandler.pingInterval);
      HMRHandler.pingInterval = null;
    }

    for (const client of HMRHandler.clientsMap.values()) {
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
