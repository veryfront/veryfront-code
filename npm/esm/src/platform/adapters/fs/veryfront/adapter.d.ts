import type { CacheStats, DirectoryEntry, FSAdapter, FSAdapterConfig, ResolvedContentContext } from "./types.js";
import type { FileInfo } from "../../base.js";
import { VeryfrontAPIClient } from "../../veryfront-api-client/index.js";
import type { Project } from "../../veryfront-api-client/index.js";
export declare class VeryfrontFSAdapter implements FSAdapter {
    private client;
    private cache;
    private normalizer;
    private readOps;
    private dirOps;
    private statOps;
    private initialized;
    /** Resolves when file list initialization is complete (for coordinating reads) */
    private fileListReadyResolve;
    /** Rejects when file list initialization fails */
    private fileListReadyReject;
    private projectData?;
    private apiBaseUrl;
    private apiToken;
    private projectSlug;
    private invalidationCallbacks;
    private wsManager;
    /** Per-request branch override (for branch preview URLs) */
    private requestBranch;
    /** Content source configuration from config */
    private contentSource;
    /** Resolved content context after initialization (includes resolved releaseId for env/domain) */
    private contentContext;
    /** Whether running in proxy mode (shared adapter with per-request OAuth tokens) */
    private proxyMode;
    constructor(config: FSAdapterConfig);
    initialize(): Promise<void>;
    private resolveContentSource;
    private fetchFileList;
    private isPersistentCacheInvalidated;
    getPokeMetrics(): {
        received: number;
        invalidationsTriggered: number;
        lastPokeTime: number;
        connectionId: string | null;
    };
    readFile(path: string): Promise<string>;
    readFileBytes(path: string): Promise<Uint8Array>;
    readTextFile(path: string): Promise<string>;
    readdir(path: string): Promise<DirectoryEntry[]>;
    stat(path: string): Promise<FileInfo>;
    exists(path: string): Promise<boolean>;
    resolveFile(basePath: string): Promise<string | null>;
    dispose(): void;
    getCacheStats(): CacheStats;
    getProjectData(): Project | undefined;
    getAllSourceFiles(): Promise<Array<{
        path: string;
        content?: string;
    }>>;
    getEntityIdForPath(path: string): string | undefined;
    getFilePathByEntityId(entityId: string): string | undefined;
    getFilePathByEntityIdAsync(entityId: string): Promise<{
        path: string;
        body?: string;
    } | undefined>;
    setRequestToken(token: string): void;
    clearRequestToken(): void;
    setRequestBranch(branch: string | null): void;
    getRequestBranch(): string | null;
    clearRequestBranch(): void;
    setContentContext(context: ResolvedContentContext): void;
    getContentContext(): ResolvedContentContext | null;
    getClient(): VeryfrontAPIClient;
    private ensureInitialized;
    /**
     * Trigger CSS pre-generation for faster first-request latency.
     *
     * Runs CSS extraction and generation in parallel with other initialization.
     * Uses dynamic import to avoid circular dependencies.
     */
    private triggerCSSPregeneration;
}
//# sourceMappingURL=adapter.d.ts.map