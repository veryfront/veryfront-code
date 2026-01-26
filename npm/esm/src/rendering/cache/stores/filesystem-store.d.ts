import type { CachePayload, CacheStore } from "../types.js";
export interface FilesystemCacheStoreOptions {
    baseDir: string;
}
export declare class FilesystemCacheStore implements CacheStore {
    private baseDir;
    private localAdapterPromise;
    constructor(options: FilesystemCacheStoreOptions);
    private getLocalFS;
    get(key: string): Promise<CachePayload | undefined>;
    set(key: string, value: CachePayload): Promise<void>;
    delete(key: string): Promise<void>;
    deleteByPrefix(prefix: string): Promise<number>;
    clear(): Promise<void>;
    destroy(): Promise<void>;
    private filePathForKey;
    private ensureDir;
    private readFileForKey;
}
//# sourceMappingURL=filesystem-store.d.ts.map