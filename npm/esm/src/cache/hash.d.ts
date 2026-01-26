/**
 * Cache key types for different cache domains.
 * Using type prefixes prevents collisions between different caches.
 */
export type CacheKeyType = "http" | "mod" | "esm" | "render" | "mdx" | "css" | "file" | "config";
/**
 * Fast, synchronous hash function for cache keys.
 *
 * Uses DJB2 algorithm - good distribution, very fast.
 * Returns a positive number suitable for string conversion.
 *
 * @param input - String to hash
 * @returns Positive integer hash
 */
export declare function fastHash(input: string): number;
/**
 * Convert a hash number to a compact string representation.
 *
 * Uses base36 for compact output (0-9, a-z).
 */
export declare function hashToString(hash: number): string;
/**
 * Fast synchronous hash that returns a string.
 *
 * Combines fastHash + hashToString for convenience.
 */
export declare function hashString(input: string): string;
/**
 * Generate a cache key with type prefix.
 *
 * Format: `{type}:{hash}`
 *
 * @example
 * ```typescript
 * getCacheKey("http", "https://esm.sh/react@18.3.1")
 * // Returns: "http:1abc2def"
 *
 * getCacheKey("mod", "pages/index.tsx")
 * // Returns: "mod:xyz789"
 * ```
 */
export declare function getCacheKey(type: CacheKeyType, input: string): string;
/**
 * Generate a versioned cache key with type prefix.
 *
 * Format: `{type}:v{version}:{hash}`
 *
 * @example
 * ```typescript
 * getVersionedCacheKey("mod", 12, "pages/index.tsx:abc123")
 * // Returns: "mod:v12:xyz789"
 * ```
 */
export declare function getVersionedCacheKey(type: CacheKeyType, version: number | string, input: string): string;
/**
 * Generate a cache key with multiple components.
 *
 * Useful for keys that depend on multiple inputs.
 * Components are joined with colons before hashing.
 *
 * @example
 * ```typescript
 * getCompoundCacheKey("mod", ["projectId", "filePath", "contentHash"])
 * // Returns: "mod:abc123"
 * ```
 */
export declare function getCompoundCacheKey(type: CacheKeyType, components: string[]): string;
/**
 * Parse a cache key into its components.
 *
 * @returns The type prefix and hash, or null if invalid format
 */
export declare function parseCacheKey(key: string): {
    type: string;
    hash: string;
    version?: string;
} | null;
/**
 * SHA-256 async hash for content-addressed keys.
 *
 * Use this when you need cryptographic strength (e.g., content hashes).
 * For cache keys where speed matters more, use hashString().
 */
export declare function sha256Hash(input: string): Promise<string>;
/**
 * Short SHA-256 hash (8 characters).
 *
 * Good balance between collision resistance and key length.
 */
export declare function sha256Short(input: string): Promise<string>;
/**
 * Generate HTTP bundle filename from URL.
 *
 * Consistent with existing http-cache.ts format: `http-{hash}.mjs`
 */
export declare function getHttpBundleFilename(normalizedUrl: string): string;
/**
 * Extract hash from HTTP bundle filename.
 *
 * @returns The hash string, or null if not a valid bundle filename
 */
export declare function parseHttpBundleFilename(filename: string): string | null;
/**
 * Check if a value looks like a cache key.
 */
export declare function isCacheKey(value: string): boolean;
//# sourceMappingURL=hash.d.ts.map