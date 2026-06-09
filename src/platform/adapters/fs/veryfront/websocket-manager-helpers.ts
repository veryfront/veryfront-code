import type { ContentSource, PreviewStyleArtifactInfo, ResolvedContentContext } from "./types.ts";
import { buildFileCacheKeyPrefix } from "./cache-keys.ts";

export const INVALIDATION_DEBOUNCE_MS = 100;
export const WS_RECONNECT_DELAY_MS = 5000;
export const WS_RECONNECT_MAX_DELAY_MS = 120000;
export const WS_RECONNECT_MAX_FAILURES = 10;
export const WS_HEARTBEAT_INTERVAL_MS = 60000;
export const WS_HEARTBEAT_TIMEOUT_MS = 300000;

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

export function parsePokeWebSocketMessage(data: string): PokeWebSocketMessage | null {
  const raw: unknown = JSON.parse(data);
  if (!raw || typeof raw !== "object") return null;

  const message = raw as Record<string, unknown>;
  const type = message.type;
  if (type !== "poke" && type !== "entity_updated") return null;

  return {
    type,
    payload: message.data && typeof message.data === "object"
      ? message.data as Record<string, unknown>
      : {},
  };
}
