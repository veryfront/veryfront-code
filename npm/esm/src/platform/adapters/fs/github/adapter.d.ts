import type { FSAdapter, FSAdapterConfig } from "../veryfront/types.js";
import { type DirectoryEntry, type FileInfo } from "./types.js";
export declare class GitHubFSAdapter implements FSAdapter {
    private readonly config;
    private readonly client;
    private readonly cache;
    private readonly statOps;
    private readonly readOps;
    private readonly dirOps;
    private readonly projectDir;
    private initialized;
    constructor(adapterConfig: FSAdapterConfig);
    initialize(): Promise<void>;
    readFile(path: string): Promise<Uint8Array | string>;
    readTextFile(path: string): Promise<string>;
    exists(path: string): Promise<boolean>;
    stat(path: string): Promise<FileInfo>;
    readDir(path: string): AsyncIterable<DirectoryEntry>;
    readdir(path: string): Promise<DirectoryEntry[]>;
    resolveFile(basePath: string): Promise<string | null>;
    getCacheStats(): {
        cache: {
            size: number;
            memoryUsed: number;
            hits: number;
            misses: number;
            hitRate: number;
        };
    };
    getRateLimitInfo(): {
        limit: number;
        remaining: number;
        reset: Date;
    } | null;
    dispose(): void;
    private ensureInitialized;
}
//# sourceMappingURL=adapter.d.ts.map