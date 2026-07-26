import { logger as baseLogger } from "#veryfront/utils/logger/logger.ts";
import type { ContentSource, PreviewStyleArtifactInfo, ResolvedContentContext } from "./types.ts";
import { buildFileCacheKeyPrefix } from "./cache-keys.ts";
import { computeContentSourceId } from "#veryfront/cache/keys.ts";

const logger = baseLogger.component("ws-helpers");

export const INVALIDATION_DEBOUNCE_MS = 100;
export const WS_RECONNECT_DELAY_MS = 5000;
export const WS_RECONNECT_MAX_DELAY_MS = 120000;
export const WS_RECONNECT_MAX_FAILURES = 10;
export const WS_HEARTBEAT_INTERVAL_MS = 60000;
export const WS_HEARTBEAT_TIMEOUT_MS = 300000;
export const WS_MAX_MESSAGE_CODE_UNITS = 256 * 1024;
export const WS_MAX_CHANGED_PATHS = 1_000;

export function getConnectionLogContext(
  projectSlug: string | undefined,
  context: Record<string, unknown> = {},
): Record<string, unknown> {
  if (!projectSlug) return context;
  return { projectSlug, ...context };
}

export function getPreviewInvalidationPrefixes(
  contentContext: ResolvedContentContext | null,
): string[] {
  if (contentContext?.sourceType !== "branch") return [];
  return [buildFileCacheKeyPrefix(contentContext)];
}

export function getReconnectDelay(consecutiveFailures: number): number {
  const delay = WS_RECONNECT_DELAY_MS * Math.pow(2, consecutiveFailures - 1);
  return Math.min(delay, WS_RECONNECT_MAX_DELAY_MS);
}

export function buildReloadProjectContext(
  contentContext: ResolvedContentContext | null,
  projectSlug: string,
  projectId: string,
  preparedStyleArtifact?: PreviewStyleArtifactInfo,
): {
  projectSlug: string;
  projectId: string;
  environment: "preview" | "production";
  branch: string | null;
  releaseId: string | null;
  contentSourceId: string | undefined;
  styleArtifactHash: string | undefined;
  styleAssetPath: string | undefined;
} {
  const environment: "preview" | "production" = contentContext?.sourceType === "branch"
    ? "preview"
    : "production";

  return {
    projectSlug,
    projectId,
    environment,
    branch: contentContext?.branch ?? null,
    releaseId: contentContext?.releaseId ?? null,
    contentSourceId: environment === "preview" || contentContext?.releaseId
      ? computeContentSourceId(
        false,
        environment,
        contentContext?.branch,
        contentContext?.releaseId,
      )
      : undefined,
    styleArtifactHash: preparedStyleArtifact?.hash,
    styleAssetPath: preparedStyleArtifact?.assetPath,
  };
}

export function buildContentSourceLabel(
  getContentSource: () => ContentSource,
  getContentContext: () => ResolvedContentContext | null,
): { contentSource: ContentSource; branch: string | null } {
  return {
    contentSource: getContentSource(),
    branch: getContentContext()?.branch ?? null,
  };
}

export type PokeWebSocketMessage = {
  type: "poke" | "entity_updated";
  payload: Record<string, unknown>;
};

export function parsePokeWebSocketMessage(data: unknown): PokeWebSocketMessage | null {
  if (typeof data !== "string") {
    logger.warn("parsePokeWebSocketMessage: ignored non-text WebSocket message", {
      dataType: typeof data,
    });
    return null;
  }
  if (data.length > WS_MAX_MESSAGE_CODE_UNITS) {
    logger.warn("parsePokeWebSocketMessage: WebSocket message exceeds size limit", {
      messageCodeUnits: data.length,
      maxMessageCodeUnits: WS_MAX_MESSAGE_CODE_UNITS,
    });
    return null;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    logger.warn("parsePokeWebSocketMessage: malformed JSON in WebSocket message", {
      messageCodeUnits: data.length,
    });
    return null;
  }
  if (!raw || typeof raw !== "object") return null;

  const message = raw as Record<string, unknown>;
  const type = message.type;
  if (type !== "poke" && type !== "entity_updated") return null;

  return {
    type,
    payload: message.data && typeof message.data === "object" && !Array.isArray(message.data)
      ? message.data as Record<string, unknown>
      : {},
  };
}
