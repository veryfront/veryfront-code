export interface CacheStore {
    readonly name: string;
    keys(): Iterable<string>;
    size(): number;
    deleteWhere?(predicate: (key: string) => boolean): number;
}
export declare class MapCacheStore implements CacheStore {
    readonly name: string;
    private readonly map;
    constructor(name: string, map: Map<string, unknown>);
    keys(): Iterable<string>;
    size(): number;
    deleteWhere(predicate: (key: string) => boolean): number;
}
interface LRULike {
    keys(): Iterable<string>;
    size: number;
    delete(key: string): boolean;
}
export declare class LRUCacheStore implements CacheStore {
    readonly name: string;
    private readonly cache;
    constructor(name: string, cache: LRULike);
    keys(): Iterable<string>;
    size(): number;
    deleteWhere(predicate: (key: string) => boolean): number;
}
declare class CacheRegistry {
    private stores;
    register(store: CacheStore): void;
    unregister(name: string): boolean;
    get(name: string): CacheStore | undefined;
    getStoreNames(): string[];
    getAllKeys(): Map<string, string[]>;
    getKeysForProject(projectId: string): Map<string, string[]>;
    countKeysForProject(projectId: string): number;
    deleteKeysForProject(projectId: string): number;
    /** Delete cache entries for a specific project and environment */
    deleteKeysForProjectEnvironment(projectId: string, environment: "production" | "preview"): number;
    /** Delete cache entries for a specific content source (branch or release) */
    deleteKeysForContentSource(projectId: string, contentSourceId: string): number;
    getStats(): Array<{
        name: string;
        size: number;
        sampleKeys: string[];
    }>;
    clear(): void;
    scanRedisKeys(pattern: string, limit?: number): Promise<string[]>;
    getRedisKeysForProject(projectId: string): Promise<Map<string, string[]>>;
    getAllKeysForProjectAsync(projectId: string, includeRedis?: boolean): Promise<{
        memory: Map<string, string[]>;
        redis: Map<string, string[]>;
    }>;
    deleteRedisKeysForProject(projectId: string): Promise<number>;
    deleteAllKeysForProjectAsync(projectId: string): Promise<{
        memoryDeleted: number;
        redisDeleted: number;
    }>;
    /** Delete all cache entries for a specific project and environment (memory + Redis) */
    deleteAllKeysForProjectEnvironmentAsync(projectId: string, environment: "production" | "preview"): Promise<{
        memoryDeleted: number;
        redisDeleted: number;
    }>;
    private deleteRedisKeysForProjectEnvironment;
}
export declare function isKeyForProject(key: string, projectId: string): boolean;
/** Check if a cache key belongs to a specific project and environment */
export declare function isKeyForProjectEnvironment(key: string, projectId: string, environment: "production" | "preview"): boolean;
export declare function extractProjectIdFromKey(key: string): string | null;
export declare const cacheRegistry: CacheRegistry;
export declare function registerMapCache(name: string, map: Map<string, unknown>): void;
export declare function registerLRUCache(name: string, cache: LRULike): void;
export {};
//# sourceMappingURL=registry.d.ts.map