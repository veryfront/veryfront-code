import type { FileCache } from "../cache/file-cache.js";
import type { VeryfrontAPIClient } from "../../veryfront-api-client/index.js";
import type { ContentSource, InvalidationCallbacks, ResolvedContentContext } from "./types.js";
/**
 * Dependencies injected by the adapter for the WebSocket manager to
 * interact with caches, the API client, and the adapter's internal state.
 */
export interface WebSocketDeps {
    apiBaseUrl: string;
    apiToken: string;
    projectSlug: string;
    cache: FileCache;
    client: VeryfrontAPIClient;
    invalidationCallbacks: InvalidationCallbacks;
    /** Returns the current content context (may change over lifetime). */
    getContentContext: () => ResolvedContentContext | null;
    /** Returns the static content source configuration. */
    getContentSource: () => ContentSource;
    /** Returns the project directory from the path normalizer. */
    getProjectDir: () => string | undefined;
    /** Clears all in-memory operation caches (file list index, stat index, dir tree). */
    clearMemoryCaches: () => void;
    /** Clears and rebuilds the file list index after cache update. */
    clearFileListIndex: () => void;
    /** Sets a new file list in the async cache. */
    setFileListCache: (cacheKey: string, files: Array<{
        path: string;
        content?: string;
    }>) => Promise<void>;
}
export declare class WebSocketManager {
    private readonly deps;
    private ws;
    private wsReconnectTimer;
    private wsHeartbeatTimer;
    private wsLastPong;
    private invalidationTimer;
    private selectiveInvalidationTimer;
    private pendingChangedPaths;
    /** WebSocket connection identity for observability */
    private wsConnectionId;
    /** Poke notification metrics for observability */
    private pokeMetrics;
    constructor(deps: WebSocketDeps);
    getPokeMetrics(): {
        received: number;
        invalidationsTriggered: number;
        lastPokeTime: number;
        connectionId: string | null;
    };
    connect(projectId: string): void;
    dispose(): void;
    private handlePokeMessage;
    private clearPersistentCacheForPublish;
    private scheduleInvalidation;
    private scheduleSelectiveInvalidation;
    private performSelectiveInvalidation;
    private performInvalidation;
    private startHeartbeat;
    private cleanupTimers;
    private sendPokeAck;
}
//# sourceMappingURL=websocket-manager.d.ts.map