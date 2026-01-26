import type { FileInfo } from "../../base.js";
import type { VeryfrontAPIClient } from "../../veryfront-api-client/index.js";
import { FileCache } from "../cache/file-cache.js";
import { PathNormalizer } from "./path-normalizer.js";
import type { ContentContextProvider } from "./read-operations.js";
export declare class StatOperations {
    private readonly client;
    private readonly cache;
    private readonly normalizer;
    private readonly contextProvider?;
    private fileIndex;
    private directoryIndex;
    private buildingIndex;
    private indexBuildLockResolver;
    private indexBuildLockPromise;
    private pathMapping;
    private apiSearchFailures;
    private apiSearchDisabledUntil;
    constructor(client: VeryfrontAPIClient, cache: FileCache, normalizer: PathNormalizer, contextProvider?: ContentContextProvider | undefined);
    stat(path: string): Promise<FileInfo>;
    private ensureIndexBuilt;
    private buildIndex;
    clearIndex(): void;
    getOriginalApiPath(normalizedPath: string): string;
    private getAllFilesRaw;
    exists(path: string): Promise<boolean>;
    resolveFile(basePath: string): Promise<string | null>;
}
//# sourceMappingURL=stat-operations.d.ts.map