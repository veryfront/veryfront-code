export interface KvEntry<T = unknown> {
    key: string[];
    value: T;
    versionstamp?: string;
}
export interface KvListOptions {
    prefix?: string[];
    start?: string[];
    end?: string[];
    limit?: number;
    reverse?: boolean;
}
export interface Kv {
    get<T = unknown>(key: string[]): Promise<{
        value: T | undefined;
        versionstamp?: string;
    }>;
    set<T = unknown>(key: string[], value: T): Promise<void>;
    delete(key: string[]): Promise<void>;
    list<T = unknown>(options?: KvListOptions): AsyncIterableIterator<KvEntry<T>>;
    close(): void;
}
export interface SqliteDatabase {
    exec(sql: string): void;
    prepare(sql: string): {
        get(...params: unknown[]): unknown;
        run(...params: unknown[]): void;
        all(...params: unknown[]): unknown[];
    };
    close(): void;
}
//# sourceMappingURL=types.d.ts.map