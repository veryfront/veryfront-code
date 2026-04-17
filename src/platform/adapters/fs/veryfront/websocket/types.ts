import type { FileCache } from "../../cache/file-cache.ts";
import type { VeryfrontApiClient } from "../../../veryfront-api-client/index.ts";
import type { ContentSource, InvalidationCallbacks, ResolvedContentContext } from "../types.ts";

export interface PreviewStyleArtifactInfo {
  hash: string;
  assetPath: string;
}

export interface WebSocketDeps {
  apiBaseUrl: string;
  apiToken: string;
  projectSlug: string;
  cache: FileCache;
  client: VeryfrontApiClient;
  invalidationCallbacks: InvalidationCallbacks;

  getContentContext: () => ResolvedContentContext | null;
  getContentSource: () => ContentSource;
  getProjectDir: () => string | undefined;
  clearMemoryCaches: () => void;
  clearFileListIndex: () => void;
  setFileListCache: (
    cacheKey: string,
    files: Array<{ path: string; content?: string }>,
  ) => Promise<void>;
  pregenerateStyles?: (
    files: Array<{ path: string; content?: string }>,
  ) => Promise<PreviewStyleArtifactInfo | undefined>;
}

export interface PokeMetrics {
  received: number;
  invalidationsTriggered: number;
  lastPokeTime: number;
}

export type PokeAckType = "selective" | "full";
