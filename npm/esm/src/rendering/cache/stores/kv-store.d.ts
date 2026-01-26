import type { CachePayload, CacheStore } from "../types.js";
export interface KVCacheStoreOptions {
    path?: string;
}
export declare class KVCacheStore implements CacheStore {
    private kv;
    private readonly path?;
    constructor(options?: KVCacheStoreOptions);
    private ensureKV;
    get(key: string): Promise<CachePayload | undefined>;
    set(key: string, value: CachePayload): Promise<void>;
    delete(key: string): Promise<void>;
    deleteByPrefix(prefix: string): Promise<number>;
    clear(): Promise<void>;
    destroy(): Promise<void>;
}
//# sourceMappingURL=kv-store.d.ts.map