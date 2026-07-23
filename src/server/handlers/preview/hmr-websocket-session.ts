import { VeryfrontError } from "#veryfront/errors";
import { isExtendedFSAdapter } from "#veryfront/platform/adapters/fs/wrapper.ts";
import type { RuntimeResponse } from "#veryfront/platform/adapters/base.ts";
import { serverLogger } from "#veryfront/utils";
import type { HandlerContext } from "../types.ts";
import {
  addClient,
  getClient,
  getClientCount,
  type HMRClientScope,
  removeClient,
} from "./hmr-client-manager.ts";
import { handleHmrClientMessage } from "./hmr-client-message.ts";
import {
  getHmrRateLimiter,
  initializeHmrRuntime,
  teardownHmrRuntimeIfUnused,
} from "./hmr-runtime.ts";
import { privateHmrResponse } from "./hmr-request-policy.ts";

const logger = serverLogger.component("hmr-handler");
const HMR_WEBSOCKET_UPGRADE_OPTIONS = { idleTimeout: 0 } as const;
const HMR_CLOSE_CONNECTION_FAILED = 1011;

function getMessageEventData(event: Event): unknown {
  return "data" in event ? (event as { data: unknown }).data : undefined;
}

export async function initializeRemoteHmrAdapter(ctx: HandlerContext): Promise<void> {
  const { projectSlug, proxyToken, adapter, resolvedEnvironment } = ctx;
  if (!projectSlug || !proxyToken || !adapter?.fs || resolvedEnvironment !== "preview") return;
  const fs = adapter.fs;
  if (!isExtendedFSAdapter(fs) || !fs.isMultiProjectMode()) return;
  logger.debug("Ensuring adapter initialized for preview HMR");
  try {
    await fs.runWithContext(
      projectSlug,
      proxyToken,
      async () => {
        await fs.exists("veryfront.config.ts");
        logger.info("Adapter initialized for poke reception");
      },
      ctx.projectId,
      {
        productionMode: false,
        branch: ctx.requestContext?.branch ?? ctx.parsedDomain?.branch ?? null,
        environmentName: ctx.environmentName ?? null,
      },
    );
  } catch (error) {
    logger.warn("Adapter initialization failed (pokes may not be received)", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
  }
}

export function upgradeHmrWebSocket(
  req: Request,
  ctx: HandlerContext,
  scope: HMRClientScope,
): RuntimeResponse {
  initializeHmrRuntime();
  try {
    const { socket, response } = ctx.adapter.server!.upgradeWebSocket(
      req,
      HMR_WEBSOCKET_UPGRADE_OPTIONS,
    );
    const now = Date.now();
    const clientId = crypto.randomUUID();
    if (!addClient({ id: clientId, socket, connectedAt: now, ...scope, lastActivity: now })) {
      teardownHmrRuntimeIfUnused();
      return response;
    }

    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      socket.removeEventListener("open", sendConnected);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("close", cleanup);
      socket.removeEventListener("error", onError);
      getHmrRateLimiter().cleanup(socket);
      removeClient(clientId);
      teardownHmrRuntimeIfUnused();
    };
    const closeAndCleanup = (code: number, reason: string) => {
      try {
        if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) {
          socket.close(code, reason);
        }
      } finally {
        cleanup();
      }
    };
    const sendConnected = () => {
      if (cleanedUp) return;
      try {
        socket.send(JSON.stringify({ type: "connected" }));
      } catch {
        closeAndCleanup(HMR_CLOSE_CONNECTION_FAILED, "Connection failed");
      }
    };
    const onMessage = (event: Event) => {
      const keepOpen = handleHmrClientMessage({
        socket,
        data: getMessageEventData(event),
        rateLimiter: getHmrRateLimiter(),
        onActivity: () => {
          const client = getClient(clientId);
          if (client) client.lastActivity = Date.now();
        },
      });
      if (!keepOpen) cleanup();
    };
    const onError = () => closeAndCleanup(HMR_CLOSE_CONNECTION_FAILED, "Connection failed");
    socket.addEventListener("close", cleanup, { once: true });
    socket.addEventListener("error", onError, { once: true });
    socket.addEventListener("message", onMessage);
    if (socket.readyState === WebSocket.OPEN) sendConnected();
    else if (socket.readyState === WebSocket.CONNECTING) {
      socket.addEventListener("open", sendConnected, { once: true });
    } else cleanup();
    logger.debug("Client connected", { totalClients: getClientCount() });
    return response;
  } catch (error) {
    teardownHmrRuntimeIfUnused();
    if (error instanceof VeryfrontError && error.status === 501) {
      logger.warn("WebSocket upgrade not supported by runtime", { errorType: error.name });
      return privateHmrResponse("WebSocket not supported", { status: 501 });
    }
    logger.error("WebSocket upgrade failed", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return privateHmrResponse("WebSocket upgrade failed", { status: 500 });
  }
}
