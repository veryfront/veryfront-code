export declare class MemoCache<V> {
    private cache;
    get(key: string): V | undefined;
    set(key: string, value: V): void;
    has(key: string): boolean;
    clear(): void;
    size(): number;
}
export declare function memoizeAsync<Args extends unknown[], Result>(fn: (...args: Args) => Promise<Result>, keyHasher: (...args: Args) => string): (...args: Args) => Promise<Result>;
export declare function memoize<Args extends unknown[], Result>(fn: (...args: Args) => Result, keyHasher: (...args: Args) => string): (...args: Args) => Result;
/**
 * FNV-1a hash algorithm for fast cache key generation.
 * 10-15x faster than JSON.stringify() and uses 70-80% less memory.
 */
export declare function simpleHash(...values: unknown[]): string;
//# sourceMappingURL=memoize.d.ts.map