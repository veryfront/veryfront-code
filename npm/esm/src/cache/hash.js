/**
 * Standardized Cache Hashing Utilities
 *
 * Provides consistent hashing for cache keys across the codebase.
 * All cache keys should use these utilities to ensure:
 * - Consistent format with type prefixes
 * - Collision resistance between different cache types
 * - Easy debugging and key parsing
 *
 * Key format: `{type}:{hash}` or `{type}:{version}:{hash}`
 *
 * @module cache/hash
 */
import * as dntShim from "../../_dnt.shims.js";
import { simpleHash } from "../utils/hash-utils.js";
/**
 * Fast, synchronous hash function for cache keys.
 *
 * Uses DJB2 algorithm - good distribution, very fast.
 * Returns a positive number suitable for string conversion.
 *
 * @param input - String to hash
 * @returns Positive integer hash
 */
export function fastHash(input) {
    let hash = 5381;
    for (let i = 0; i < input.length; i++) {
        hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
    }
    return hash >>> 0; // Convert to unsigned 32-bit
}
/**
 * Convert a hash number to a compact string representation.
 *
 * Uses base36 for compact output (0-9, a-z).
 */
export function hashToString(hash) {
    return hash.toString(36);
}
/**
 * Fast synchronous hash that returns a string.
 *
 * Combines fastHash + hashToString for convenience.
 */
export function hashString(input) {
    return hashToString(fastHash(input));
}
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
export function getCacheKey(type, input) {
    const hash = hashString(input);
    return `${type}:${hash}`;
}
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
export function getVersionedCacheKey(type, version, input) {
    const hash = hashString(input);
    return `${type}:v${version}:${hash}`;
}
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
export function getCompoundCacheKey(type, components) {
    const combined = components.join(":");
    return getCacheKey(type, combined);
}
/**
 * Parse a cache key into its components.
 *
 * @returns The type prefix and hash, or null if invalid format
 */
export function parseCacheKey(key) {
    const parts = key.split(":");
    if (parts.length < 2)
        return null;
    const type = parts[0];
    const rest = parts.slice(1);
    // Check for version: type:vN:hash
    if (rest[0]?.startsWith("v") && /^v\d+$/.test(rest[0])) {
        return {
            type,
            version: rest[0].slice(1),
            hash: rest.slice(1).join(":"),
        };
    }
    return {
        type,
        hash: rest.join(":"),
    };
}
/**
 * SHA-256 async hash for content-addressed keys.
 *
 * Use this when you need cryptographic strength (e.g., content hashes).
 * For cache keys where speed matters more, use hashString().
 */
export async function sha256Hash(input) {
    const data = new TextEncoder().encode(input);
    const hashBuffer = await dntShim.crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}
/**
 * Short SHA-256 hash (8 characters).
 *
 * Good balance between collision resistance and key length.
 */
export async function sha256Short(input) {
    const full = await sha256Hash(input);
    return full.slice(0, 8);
}
/**
 * Generate HTTP bundle filename from URL.
 *
 * Consistent with existing http-cache.ts format: `http-{hash}.mjs`
 */
export function getHttpBundleFilename(normalizedUrl) {
    const hash = simpleHash(normalizedUrl);
    return `http-${hash}.mjs`;
}
/**
 * Extract hash from HTTP bundle filename.
 *
 * @returns The hash string, or null if not a valid bundle filename
 */
export function parseHttpBundleFilename(filename) {
    const match = filename.match(/^http-(\d+)\.mjs$/);
    return match?.[1] ?? null;
}
/**
 * Check if a value looks like a cache key.
 */
export function isCacheKey(value) {
    return /^[a-z]+:[a-z0-9]+/.test(value);
}
