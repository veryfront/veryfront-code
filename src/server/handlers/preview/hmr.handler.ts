import { HMR_MAX_MESSAGES_PER_MINUTE, serverLogger } from "#veryfront/utils";
import { RateLimiter } from "#veryfront/modules/server/index.ts";
import { VeryfrontError } from "#veryfront/errors";
import { BaseHandler } from "../response/base.ts";
import {
  type HandlerContext,
  type HandlerMetadata,
  HandlerPriority,
  type HandlerResult,
} from "../types.ts";
import { ReloadNotifier } from "../../reload-notifier.ts";
import { invalidateProjectCaches } from "../../context/cache-invalidation.ts";
import {
  addClient,
  clearAll,
  getClient,
  getClientCount,
  getClientCountForProject,
  getClientDetails,
  removeClient,
} from "./hmr-client-manager.ts";
import { handleHmrClientMessage } from "./hmr-client-message.ts";
import { getPingIntervalMs, startPingInterval, stopPingInterval } from "./hmr-ping-keepalive.ts";
import { broadcastUpdate, getMetrics } from "./hmr-message-router.ts";
import { isProxyTrusted } from "../../utils/proxy-trust.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";

const logger = serverLogger.component("hmr-handler");
const HMR_WEBSOCKET_UPGRADE_OPTIONS = { idleTimeout: 0 } as const;
const DEFAULT_HMR_GLOBAL_CLIENT_LIMIT = 500;
const DEFAULT_HMR_PROJECT_CLIENT_LIMIT = 50;
const MAX_CONFIGURED_HMR_CLIENT_LIMIT = 100_000;

// Re-export the interface so external consumers can still access it from this module
export type { HMRClientInfo } from "./hmr-client-manager.ts";

// Priority between auth (0) and high (100)
const PRIORITY_HMR: HandlerPriority = HandlerPriority.EARLY;

function getMessageEventData(event: Event): unknown {
  return "data" in event ? (event as { data: unknown }).data : undefined;
}

function getHmrClientLimit(name: string, fallback: number): number {
  const raw = getHostEnv(name);
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= MAX_CONFIGURED_HMR_CLIENT_LIMIT
    ? parsed
    : fallback;
}

export class HMRHandler extends BaseHandler {
  private static rateLimiter = new RateLimiter(HMR_MAX_MESSAGES_PER_MINUTE);
  private static reloadUnsubscribe: (() => void) | null = null;
  private static lifecycleOwners = new Set<object>();
  private static externalBroadcastSources = new Set<object>();
  private static reloadTaskTail: Promise<void> = Promise.resolve();
  private static reloadGeneration = 0;
  private static acceptingReloads = true;
  private static shutdownState: {
    readonly retiringTail: Promise<void>;
    unsubscribeComplete: boolean;
    tailDrained: boolean;
    pingStopped: boolean;
    clientsCleared: boolean;
  } | null = null;
  private static shutdownInFlight: Promise<void> | null = null;
  private static initialized = false;

  metadata: HandlerMetadata = {
    name: "HMRHandler",
    priority: PRIORITY_HMR,
    patterns: [{ pattern: "/_ws", exact: true }],
    enabled: () => true,
  };

  private static ensureReloadSubscription(): void {
    if (HMRHandler.reloadUnsubscribe) return;
    logger.info("Subscribing to ReloadNotifier");

    HMRHandler.reloadUnsubscribe = ReloadNotifier.subscribe((changedPaths, project) => {
      if (!HMRHandler.acceptingReloads) return;

      logger.debug("ReloadNotifier callback triggered", {
        changedPaths,
        projectSlug: project?.projectSlug,
        clientCount: getClientCount(),
      });

      const projectSlug = project?.projectSlug ?? "preview";
      const generation = HMRHandler.reloadGeneration;

      // Keep invalidate -> broadcast sequences ordered. A slow Redis purge for
      // one change must not let a later reload overtake it and reach clients
      // first. The tail always recovers so one unexpected failure cannot poison
      // subsequent reloads.
      HMRHandler.reloadTaskTail = HMRHandler.reloadTaskTail.then(async () => {
        if (generation !== HMRHandler.reloadGeneration) return;
        try {
          await invalidateProjectCaches(projectSlug, changedPaths, {
            projectId: project?.projectId,
            projectDir: project?.projectDir,
            environment: project?.environment,
            branchId: project?.branch ?? undefined,
            releaseId: project?.releaseId,
            contentSourceId: project?.contentSourceId,
          });
        } catch (error) {
          logger.error("Project cache invalidation failed before HMR broadcast", {
            projectSlug: project?.projectSlug,
            errorName: error instanceof Error ? error.name : typeof error,
          });
          // A reload broadcast asserts that the server can serve fresh state.
          // Preserve the recovered task tail, but fail closed for this change.
          return;
        }

        if (generation !== HMRHandler.reloadGeneration) return;
        broadcastUpdate(changedPaths, project);
      }).catch((error) => {
        logger.error("Unexpected HMR reload task failure", {
          projectSlug: project?.projectSlug,
          errorName: error instanceof Error ? error.name : typeof error,
        });
      });
    });
  }

  private static initialize(): void {
    if (HMRHandler.initialized) return;
    HMRHandler.initialized = true;

    HMRHandler.ensureReloadSubscription();

    startPingInterval();

    logger.debug("Initialized - listening for reload events", {
      pingIntervalMs: getPingIntervalMs(),
    });
  }

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (!this.shouldHandle(req, ctx)) return this.continue();

    const url = new URL(req.url);
    const queryEnv = url.searchParams.get("x-environment");
    // Preview authorization comes only from the server-resolved context. The
    // browser-controlled query parameter is retained for compatibility and
    // diagnostics, but cannot promote a production request into HMR access.
    const isPreviewMode = ctx.resolvedEnvironment === "preview" ||
      ctx.requestContext?.mode === "preview";
    const isLocal = !!ctx.isLocalProject;
    const publicKeyPem = ctx.adapter?.env?.get("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY") ??
      getHostEnv("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY");
    const proxyTrusted = await isProxyTrusted(req, { publicKeyPem });
    const hasCallerSuppliedProjectScope = [
      "x-project-slug",
      "x-project-id",
      "x-branch-id",
      "x-content-source-id",
      "x-release-id",
    ].some((header) => req.headers.has(header) || url.searchParams.has(header));

    if (
      (!isLocal && !isPreviewMode) ||
      (!isLocal && hasCallerSuppliedProjectScope && !proxyTrusted)
    ) {
      logger.warn("Skipping unauthorized /_ws request", {
        mode: ctx.requestContext?.mode,
        resolvedEnvironment: ctx.resolvedEnvironment,
        queryEnv,
        isLocalProject: ctx.isLocalProject,
        isPreviewMode,
        proxyTrusted,
        hasCallerSuppliedProjectScope,
      });
      return this.continue();
    }

    const clientProjectSlug = ctx.projectSlug?.trim() || undefined;
    if (!isLocal && !clientProjectSlug) {
      return this.respond(new Response("Preview HMR requires a resolved project", { status: 400 }));
    }

    HMRHandler.initialize();

    if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      if (!isLocal) {
        return this.respond(
          new Response("WebSocket upgrade required", {
            status: 426,
            headers: { "cache-control": "no-store" },
          }),
        );
      }
      return this.respond(
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
      );
    }

    if (!ctx.adapter?.server) {
      return this.respond(new Response("WebSocket not supported", { status: 501 }));
    }

    const globalClientLimit = getHmrClientLimit(
      "VERYFRONT_HMR_MAX_CLIENTS",
      DEFAULT_HMR_GLOBAL_CLIENT_LIMIT,
    );
    const projectClientLimit = getHmrClientLimit(
      "VERYFRONT_HMR_MAX_CLIENTS_PER_PROJECT",
      DEFAULT_HMR_PROJECT_CLIENT_LIMIT,
    );
    if (
      getClientCount() >= globalClientLimit ||
      getClientCountForProject(clientProjectSlug) >= projectClientLimit
    ) {
      logger.warn("Rejecting HMR WebSocket connection at capacity", {
        projectSlug: clientProjectSlug,
        globalClients: getClientCount(),
        projectClients: getClientCountForProject(clientProjectSlug),
        globalClientLimit,
        projectClientLimit,
      });
      return this.respond(
        new Response("HMR connection capacity reached", {
          status: 503,
          headers: { "retry-after": "5", "cache-control": "no-store" },
        }),
      );
    }

    try {
      const { socket, response } = ctx.adapter.server.upgradeWebSocket(
        req,
        HMR_WEBSOCKET_UPGRADE_OPTIONS,
      );

      const now = Date.now();
      const clientId = crypto.randomUUID();

      addClient({
        id: clientId,
        socket,
        connectedAt: now,
        projectSlug: clientProjectSlug,
        userAgent: req.headers.get("user-agent") ?? undefined,
        lastActivity: now,
      });

      // Send connected message when socket opens
      const sendConnected = () => {
        try {
          socket.send(JSON.stringify({ type: "connected" }));
        } catch (_) {
          /* expected: socket may have closed immediately */
        }
      };

      if (socket.readyState === WebSocket.OPEN) {
        sendConnected();
      } else {
        socket.addEventListener("open", sendConnected, { once: true });
      }

      // Handle incoming messages (size/rate guard, ping/pong, activity tracking)
      socket.addEventListener("message", (event) => {
        handleHmrClientMessage({
          socket,
          data: getMessageEventData(event),
          rateLimiter: HMRHandler.rateLimiter,
          onActivity: () => {
            const client = getClient(clientId);
            if (client) {
              client.lastActivity = Date.now();
            }
          },
        });
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

      return this.respond(response);
    } catch (error) {
      if (error instanceof VeryfrontError && error.status === 501) {
        logger.warn("WebSocket upgrade not supported by runtime", { error });
        return this.respond(new Response("WebSocket not supported", { status: 501 }));
      }

      logger.error("WebSocket upgrade failed", { error });
      return this.respond(new Response("WebSocket upgrade failed", { status: 500 }));
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

  static registerExternalBroadcastSource(): () => Promise<void> {
    const registration = {};
    HMRHandler.externalBroadcastSources.add(registration);
    const releaseLifecycleOwner = HMRHandler.registerLifecycleOwner();
    // External sources (notably DevServer) are registered before the first
    // WebSocket request, so eagerly install the one reload listener that owns
    // invalidate -> broadcast ordering.
    HMRHandler.ensureReloadSubscription();

    let released = false;
    let releaseInFlight: Promise<void> | null = null;
    return () => {
      if (released) return Promise.resolve();
      if (releaseInFlight) return releaseInFlight;

      const attempt = (async () => {
        if (!HMRHandler.externalBroadcastSources.has(registration)) {
          released = true;
          return;
        }
        await releaseLifecycleOwner();
        HMRHandler.externalBroadcastSources.delete(registration);
        released = true;
      })();
      const trackedAttempt = attempt.finally(() => {
        if (releaseInFlight === trackedAttempt) releaseInFlight = null;
      });
      releaseInFlight = trackedAttempt;
      return trackedAttempt;
    };
  }

  /**
   * Retain the process-global HMR state for one live server generation.
   * Generic owners do not change project filtering and only install the reload
   * listener if an HMR request actually initializes the handler.
   */
  static registerLifecycleOwner(): () => Promise<void> {
    if (HMRHandler.shutdownState) {
      throw new Error("Cannot register an HMR lifecycle owner while shutdown is incomplete");
    }
    const owner = {};
    HMRHandler.lifecycleOwners.add(owner);
    let released = false;
    let releaseInFlight: Promise<void> | null = null;
    return () => {
      if (released) return Promise.resolve();
      if (releaseInFlight) return releaseInFlight;

      const attempt = (async () => {
        if (!HMRHandler.lifecycleOwners.has(owner)) {
          released = true;
          return;
        }
        if (HMRHandler.lifecycleOwners.size === 1) {
          // Keep the last ownership token until every global shutdown phase has
          // succeeded. If unsubscribe or another cleanup hook throws, the same
          // release function remains retryable and no replacement can assume the
          // globals are gone.
          await HMRHandler.shutdown();
        } else {
          HMRHandler.lifecycleOwners.delete(owner);
        }
        released = true;
      })();
      const trackedAttempt = attempt.finally(() => {
        if (releaseInFlight === trackedAttempt) releaseInFlight = null;
      });
      releaseInFlight = trackedAttempt;
      return trackedAttempt;
    };
  }

  static shutdown(): Promise<void> {
    if (HMRHandler.shutdownInFlight) return HMRHandler.shutdownInFlight;

    if (!HMRHandler.shutdownState) {
      // Reject newly emitted reload work immediately, and invalidate the
      // generation captured by every queued task before waiting for the tail.
      // This prevents an old generation from broadcasting after shutdown has
      // started while still allowing an in-flight cache purge to finish safely.
      HMRHandler.acceptingReloads = false;
      HMRHandler.reloadGeneration++;
      HMRHandler.shutdownState = {
        retiringTail: HMRHandler.reloadTaskTail,
        unsubscribeComplete: false,
        tailDrained: false,
        pingStopped: false,
        clientsCleared: false,
      };
    }

    const state = HMRHandler.shutdownState;
    const attempt = (async () => {
      if (!state.unsubscribeComplete) {
        HMRHandler.reloadUnsubscribe?.();
        HMRHandler.reloadUnsubscribe = null;
        state.unsubscribeComplete = true;
      }

      if (!state.tailDrained) {
        await state.retiringTail;
        state.tailDrained = true;
      }

      if (!state.pingStopped) {
        stopPingInterval();
        state.pingStopped = true;
      }
      if (!state.clientsCleared) {
        clearAll();
        state.clientsCleared = true;
      }

      HMRHandler.rateLimiter = new RateLimiter(HMR_MAX_MESSAGES_PER_MINUTE);
      HMRHandler.lifecycleOwners.clear();
      HMRHandler.externalBroadcastSources.clear();
      HMRHandler.reloadTaskTail = Promise.resolve();
      HMRHandler.initialized = false;
      HMRHandler.shutdownState = null;
      HMRHandler.acceptingReloads = true;

      logger.debug("Shutdown complete");
    })();
    const trackedAttempt = attempt.finally(() => {
      if (HMRHandler.shutdownInFlight === trackedAttempt) HMRHandler.shutdownInFlight = null;
    });
    HMRHandler.shutdownInFlight = trackedAttempt;
    return trackedAttempt;
  }
}
