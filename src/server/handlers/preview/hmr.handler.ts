import {
  HMR_CLOSE_MESSAGE_TOO_LARGE,
  HMR_CLOSE_RATE_LIMIT,
  HMR_MAX_MESSAGE_SIZE_BYTES,
  HMR_MAX_MESSAGES_PER_MINUTE,
  serverLogger,
} from "#veryfront/utils";
import { RateLimiter } from "#veryfront/modules/server/index.ts";
import { BaseHandler } from "../response/base.ts";
import {
  type HandlerContext,
  type HandlerMetadata,
  HandlerPriority,
  type HandlerResult,
} from "../types.ts";
import { ReloadNotifier } from "../../reload-notifier.ts";
import { invalidateProjectCaches } from "../../context/cache-invalidation.ts";
import { isExtendedFSAdapter } from "#veryfront/platform/adapters/fs/wrapper.ts";
import { isLocalDevHost } from "../../utils/domain-parser.ts";
import {
  addClient,
  clearAll,
  getClient,
  getClientCount,
  getClientDetails,
  removeClient,
} from "./hmr-client-manager.ts";
import { getPingIntervalMs, startPingInterval, stopPingInterval } from "./hmr-ping-keepalive.ts";
import { broadcastUpdate, getMetrics } from "./hmr-message-router.ts";

const logger = serverLogger.component("hmr-handler");

// Re-export the interface so external consumers can still access it from this module
export type { HMRClientInfo } from "./hmr-client-manager.ts";

// Priority between auth (0) and high (100)
const PRIORITY_HMR: HandlerPriority = HandlerPriority.EARLY;

export class HMRHandler extends BaseHandler {
  private static rateLimiter = new RateLimiter(HMR_MAX_MESSAGES_PER_MINUTE);
  private static reloadUnsubscribe: (() => void) | null = null;
  private static externalBroadcastSourceCount = 0;
  private static initialized = false;

  metadata: HandlerMetadata = {
    name: "HMRHandler",
    priority: PRIORITY_HMR,
    patterns: [{ pattern: "/_ws", exact: true }],
    enabled: () => true,
  };

  private static initialize(): void {
    if (HMRHandler.initialized) return;
    HMRHandler.initialized = true;

    logger.info("Subscribing to ReloadNotifier");

    HMRHandler.reloadUnsubscribe = ReloadNotifier.subscribe((changedPaths, project) => {
      logger.debug("ReloadNotifier callback triggered", {
        changedPaths,
        projectSlug: project?.projectSlug,
        clientCount: getClientCount(),
      });

      const projectSlug = project?.projectSlug ?? "preview";
      invalidateProjectCaches(projectSlug, changedPaths, {
        projectId: project?.projectId,
        environment: project?.environment,
        branchId: project?.branch ?? undefined,
      });

      if (HMRHandler.externalBroadcastSourceCount > 0) {
        logger.debug("Skipping handler broadcast - external source active", {
          projectSlug: project?.projectSlug,
          externalBroadcastSourceCount: HMRHandler.externalBroadcastSourceCount,
        });
        return;
      }

      broadcastUpdate(changedPaths, project?.projectSlug);
    });

    startPingInterval();

    logger.debug("Initialized - listening for reload events", {
      pingIntervalMs: getPingIntervalMs(),
    });
  }

  handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (!this.shouldHandle(req, ctx)) return Promise.resolve(this.continue());

    const url = new URL(req.url);
    const queryEnv = url.searchParams.get("x-environment");
    const isPreviewMode = ctx.requestContext?.mode === "preview" || queryEnv === "preview";
    const isLocal = !!ctx.isLocalProject;
    const host = req.headers.get("host") ?? "";
    const isLocalhost = isLocalDevHost(host);

    if (!isPreviewMode && !isLocal && !isLocalhost) {
      logger.warn("Skipping /_ws - not preview, local dev, or localhost", {
        mode: ctx.requestContext?.mode,
        queryEnv,
        isLocalProject: ctx.isLocalProject,
        host,
        isPreviewMode,
        isLocal,
        isLocalhost,
      });
      return Promise.resolve(this.continue());
    }

    HMRHandler.initialize();

    // In proxy mode, ensure the adapter is initialized so WebSocketManager connects
    // to receive poke notifications. Without this, pokes from API are never received
    // because adapters are lazily created only when page requests come in.
    if (ctx.projectSlug && ctx.proxyToken && ctx.adapter?.fs) {
      this.ensureAdapterInitialized(ctx).catch((error) => {
        logger.warn("Failed to ensure adapter initialization", {
          projectSlug: ctx.projectSlug,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }

    if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return Promise.resolve(
        this.respond(
          new Response(
            JSON.stringify({
              status: "ok",
              clients: getClientCount(),
              clientDetails: getClientDetails(),
              metrics: {
                ...getMetrics(),
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
        this.respond(new Response("WebSocket not supported", { status: 501 })),
      );
    }

    try {
      const { socket, response } = ctx.adapter.server.upgradeWebSocket(req);

      const now = Date.now();
      const clientId = crypto.randomUUID().slice(0, 8);

      addClient({
        id: clientId,
        socket,
        connectedAt: now,
        projectSlug: ctx.projectSlug,
        userAgent: req.headers.get("user-agent") ?? undefined,
        lastActivity: now,
      });

      // Send connected message when socket opens
      const sendConnected = () => {
        try {
          socket.send(JSON.stringify({ type: "connected" }));
        } catch {
          // Socket may have closed immediately
        }
      };

      if (socket.readyState === WebSocket.OPEN) {
        sendConnected();
      } else {
        socket.addEventListener("open", sendConnected, { once: true });
      }

      // Handle incoming messages (size/rate guard, ping/pong, activity tracking)
      socket.addEventListener("message", (event) => {
        const messageSize = HMRHandler.getMessageSize(event.data);
        if (messageSize > HMR_MAX_MESSAGE_SIZE_BYTES) {
          try {
            socket.close(HMR_CLOSE_MESSAGE_TOO_LARGE, "Message too large");
          } catch {
            // Ignore close errors
          }
          return;
        }

        if (!HMRHandler.rateLimiter.check(socket)) {
          try {
            socket.close(HMR_CLOSE_RATE_LIMIT, "Rate limit exceeded");
          } catch {
            // Ignore close errors
          }
          return;
        }

        const client = getClient(clientId);
        if (client) {
          client.lastActivity = Date.now();
        }

        if (typeof event.data !== "string") return;

        try {
          const data = JSON.parse(event.data);
          if (data?.type === "ping") {
            socket.send(JSON.stringify({ type: "pong" }));
          }
        } catch {
          // Ignore parse errors from client
        }
      });

      // Clean up on close or error
      const cleanup = () => {
        HMRHandler.rateLimiter.cleanup(socket);
        removeClient(clientId);
      };
      socket.addEventListener("close", cleanup);
      socket.addEventListener("error", cleanup);

      logger.debug("Client connected", {
        clientId,
        projectSlug: ctx.projectSlug,
        totalClients: getClientCount(),
      });

      return Promise.resolve(this.respond(response));
    } catch (error) {
      logger.error("WebSocket upgrade failed", { error });
      return Promise.resolve(
        this.respond(new Response("WebSocket upgrade failed", { status: 500 })),
      );
    }
  }

  /**
   * Ensure the adapter is initialized so WebSocketManager connects to receive pokes.
   * In proxy mode, adapters are lazily created per-project. If no page request has been
   * made for the project yet, the WebSocketManager won't be connected and pokes from
   * the API will never be received.
   */
  private async ensureAdapterInitialized(ctx: HandlerContext): Promise<void> {
    const { projectSlug, proxyToken, adapter, resolvedEnvironment } = ctx;
    if (!projectSlug || !proxyToken || !adapter?.fs) return;

    const fs = adapter.fs;
    if (!isExtendedFSAdapter(fs) || !fs.runWithContext) return;

    const isPreview = resolvedEnvironment === "preview";
    if (!isPreview) return;

    logger.debug("Ensuring adapter initialized for preview HMR", {
      projectSlug,
      resolvedEnvironment,
    });

    try {
      await fs.runWithContext(
        projectSlug,
        proxyToken,
        async () => {
          await fs.exists("veryfront.config.ts");
          logger.info("Adapter initialized for poke reception", {
            projectSlug,
          });
        },
        ctx.projectId,
        {
          productionMode: false,
          branch: ctx.requestContext?.branch ?? "main",
        },
      );
    } catch (error) {
      logger.warn("Adapter initialization failed (pokes may not be received)", {
        projectSlug,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  static getClientCount(): number {
    return getClientCount();
  }

  static getMetrics(): {
    clients: number;
    broadcastsSent: number;
    messagesForwarded: number;
    lastBroadcastTime: number;
  } {
    return getMetrics();
  }

  static registerExternalBroadcastSource(): () => void {
    HMRHandler.externalBroadcastSourceCount++;

    return () => {
      HMRHandler.externalBroadcastSourceCount = Math.max(
        0,
        HMRHandler.externalBroadcastSourceCount - 1,
      );
    };
  }

  static shutdown(): void {
    HMRHandler.reloadUnsubscribe?.();
    HMRHandler.reloadUnsubscribe = null;

    stopPingInterval();
    clearAll();
    HMRHandler.rateLimiter = new RateLimiter(HMR_MAX_MESSAGES_PER_MINUTE);
    HMRHandler.externalBroadcastSourceCount = 0;

    HMRHandler.initialized = false;

    logger.debug("Shutdown complete");
  }

  private static getMessageSize(data: unknown): number {
    if (typeof data === "string") return data.length;
    if (data instanceof ArrayBuffer) return data.byteLength;
    if (ArrayBuffer.isView(data)) return data.byteLength;
    if (data instanceof Blob) return data.size;
    return 0;
  }
}
