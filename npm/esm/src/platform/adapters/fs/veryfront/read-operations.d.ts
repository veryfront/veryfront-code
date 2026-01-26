import type { VeryfrontAPIClient } from "../../veryfront-api-client/index.js";
import { FileCache } from "../cache/file-cache.js";
import { PathNormalizer } from "./path-normalizer.js";
import type { ResolvedContentContext } from "./types.js";
export interface ContentContextProvider {
    isProductionMode: () => boolean;
    getReleaseId: () => string | null;
    getContentContext: () => ResolvedContentContext | null;
    /** Cached file list from adapter initialization (single source of truth) */
    getFileList?: () => Promise<Array<{
        id?: string;
        path: string;
        content?: string;
        type?: string;
        size?: number;
        updated_at?: string;
    }> | undefined>;
    /** True if cache prefix is being deleted - skip persistent cache reads */
    isPersistentCacheInvalidated?: (prefix: string) => boolean;
    /** Back-compat: release-scoped invalidation */
    isReleaseBeingInvalidated?: (releaseId: string) => boolean;
}
export declare class ReadOperations {
    private readonly client;
    private readonly cache;
    private readonly normalizer;
    private readonly contextProvider?;
    private readonly getOriginalApiPath?;
    private readonly getFileListCache?;
    private readonly inFlightRequests;
    private lastCleanupTime;
    private fileListIndex;
    private fileListIndexKey;
    private fileListReadyPromise;
    constructor(client: VeryfrontAPIClient, cache: FileCache, normalizer: PathNormalizer, contextProvider?: ContentContextProvider | undefined, getOriginalApiPath?: ((path: string) => string) | undefined, getFileListCache?: (() => Promise<Array<{
        path: string;
        content?: string;
    }> | undefined>) | undefined);
    setFileListReadyPromise(promise: Promise<void>): void;
    clearFileListIndex(): void;
    private cleanupStaleInFlightRequests;
    private getOrBuildFileListIndex;
    private getContentFromFileList;
    readFile(path: string): Promise<Uint8Array>;
    readTextFile(path: string): Promise<string>;
    private fetchContent;
    private fetchPublishedContent;
    private tryFallbackExtensions;
    private tryFallbackExtensionsSequential;
    private fetchDraftContent;
}
//# sourceMappingURL=read-operations.d.ts.map