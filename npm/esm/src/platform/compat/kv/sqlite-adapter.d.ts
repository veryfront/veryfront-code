import type { Kv, KvEntry, KvListOptions, SqliteDatabase } from "./types.js";
export declare class SqliteKv implements Kv {
    private db;
    constructor(db: SqliteDatabase);
    private initialize;
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
//# sourceMappingURL=sqlite-adapter.d.ts.map