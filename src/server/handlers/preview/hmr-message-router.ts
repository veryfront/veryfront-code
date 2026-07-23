import { serverLogger } from "#veryfront/utils";
import type { ReloadProjectInfo } from "../../reload-notifier.ts";
import {
  disconnectClient,
  getClientCount,
  getOpenClients,
  type HMRClientScope,
} from "./hmr-client-manager.ts";

const logger = serverLogger.component("hmr-handler");
const HMR_CLOSE_CONNECTION_FAILED = 1011;
const STYLE_ASSET_PATH_PATTERN = /^\/_vf\/css\/([a-z0-9-]{1,16})\.css$/;

interface HMRMetrics {
  broadcastsSent: number;
  messagesForwarded: number;
  lastBroadcastTime: number;
}

const metrics: HMRMetrics = {
  broadcastsSent: 0,
  messagesForwarded: 0,
  lastBroadcastTime: 0,
};

export function getMetrics(scope?: HMRClientScope): { clients: number } & HMRMetrics {
  return { clients: getClientCount(scope), ...metrics };
}

function buildStyleUpdatePayload(project?: ReloadProjectInfo): Record<string, string> {
  const assetPath = project?.styleAssetPath;
  const artifactHash = project?.styleArtifactHash;
  if (!assetPath || !artifactHash) return {};

  const pathHash = assetPath.match(STYLE_ASSET_PATH_PATTERN)?.[1];
  return pathHash === artifactHash ? { styleHref: assetPath, styleHash: artifactHash } : {};
}

function requiresFullReload(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase();
  return ext === "mdx" || ext === "md" || path.includes("veryfront.config");
}

function getProjectScope(project?: ReloadProjectInfo): HMRClientScope | null | undefined {
  if (!project) return undefined;
  if (!project.projectId && !project.projectSlug && !project.projectDir) return null;
  const scope: HMRClientScope = {
    projectSlug: project.projectSlug,
    projectId: project.projectId,
    projectDir: project.projectDir,
    environment: project.environment,
    branch: project.branch,
  };
  return scope;
}

/**
 * Broadcast update to all connected HMR clients, optionally filtered by project identity.
 * No server-side debounce is needed here because ReloadNotifier already debounces (300ms).
 */
export function broadcastUpdate(changedPaths?: string[], project?: ReloadProjectInfo): void {
  const scope = getProjectScope(project);
  if (scope === null) {
    logger.warn("Skipped scoped HMR broadcast without project identity", {
      changedPathCount: changedPaths?.length ?? 0,
      totalClients: getClientCount(),
    });
    return;
  }

  logger.debug("broadcastUpdate called", {
    changedPathCount: changedPaths?.length ?? 0,
    totalClients: getClientCount(),
  });

  const timestamp = Date.now();
  metrics.broadcastsSent++;
  metrics.lastBroadcastTime = timestamp;

  const needsFullReload = !changedPaths?.length ||
    changedPaths.some((path) => requiresFullReload(path));

  if (needsFullReload) {
    const message = JSON.stringify({ type: "reload", timestamp });
    broadcastMessage(message, scope);
    metrics.messagesForwarded++;
  } else {
    const stylePayload = buildStyleUpdatePayload(project);
    for (const path of changedPaths) {
      const message = JSON.stringify({ type: "update", path, timestamp, ...stylePayload });
      broadcastMessage(message, scope);
      metrics.messagesForwarded++;
    }
  }
}

function broadcastMessage(message: string, scope?: HMRClientScope): void {
  const clients = getOpenClients(scope);
  let sentCount = 0;

  for (const client of clients) {
    try {
      client.socket.send(message);
      sentCount++;
    } catch (error) {
      disconnectClient(client.id, HMR_CLOSE_CONNECTION_FAILED, "Connection failed");
      logger.warn("Failed to send to HMR client", {
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }

  logger.debug("broadcastMessage complete", {
    sentCount,
    totalClients: getClientCount(),
  });
}

export function resetMetrics(): void {
  metrics.broadcastsSent = 0;
  metrics.messagesForwarded = 0;
  metrics.lastBroadcastTime = 0;
}
