import type { Kv, KvEntry, KvListOptions } from "./types.js";
export declare class MemoryKv implements Kv {
    private store;
    private keyToString;
    private stringToKey;
    get<T = unknown>(key: string[]): Promise<{
        value: T | undefined;
        versionstamp?: string;
    }>;
    set<T = unknown>(key: string[], value: T): Promise<void>;
    delete(key: string[]): Promise<void>;
    list<T = unknown>(options?: KvListOptions): AsyncIterableIterator<KvEntry<T>>;
    close(): void;
}
//# sourceMappingURL=memory-adapter.d.ts.map