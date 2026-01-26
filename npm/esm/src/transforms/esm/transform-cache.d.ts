export interface TransformCacheEntry {
    code: string;
    hash: string;
    timestamp: number;
}
export declare function initializeTransformCache(): Promise<boolean>;
export declare function isDistributedCacheEnabled(): boolean;
/** @deprecated Use initializeTransformCache instead */
export declare const initializeRedisCache: typeof initializeTransformCache;
/** @deprecated Use isDistributedCacheEnabled instead */
export declare const isRedisCacheEnabled: typeof isDistributedCacheEnabled;
export declare function generateCacheKey(filePath: string, contentHash: string, ssr?: boolean, studioEmbed?: boolean): string;
export declare function getCachedTransformAsync(key: string): Promise<TransformCacheEntry | undefined>;
export declare function getCachedTransform(key: string): TransformCacheEntry | undefined;
export declare function setCachedTransformAsync(key: string, code: string, hash: string, ttlSeconds?: number): Promise<void>;
export declare function setCachedTransform(key: string, code: string, hash: string, ttlSeconds?: number): void;
export declare function destroyTransformCache(): void;
export declare function getTransformCacheStats(): {
    fallbackEntries: number;
    maxFallbackEntries: number;
    backend: string;
};
//# sourceMappingURL=transform-cache.d.ts.map