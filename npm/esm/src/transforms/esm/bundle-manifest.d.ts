/**
 * Bundle Manifest System
 *
 * Tracks HTTP bundles created during a transform as an atomic group.
 * Key invariant: a transform is never used unless ALL of its HTTP bundle
 * dependencies are confirmed present.
 *
 * @module transforms/esm/bundle-manifest
 */
/** A single HTTP bundle entry in a manifest. */
export interface BundleEntry {
    hash: string;
    url: string;
    sizeBytes: number;
}
/** A manifest tracking all HTTP bundles from a single transform. */
export interface BundleManifest {
    manifestId: string;
    bundles: BundleEntry[];
    createdAt: number;
    ttlSeconds: number;
}
/** Result of manifest validation. */
export interface ManifestValidationResult {
    valid: boolean;
    failedHashes: string[];
}
/**
 * Compute a deterministic manifest ID from bundle hashes.
 * Sorts hashes to ensure the same set of bundles always produces the same ID.
 */
export declare function computeManifestId(hashes: string[]): Promise<string>;
/**
 * Create a bundle manifest from collected bundle metadata.
 */
export declare function createBundleManifest(bundles: BundleEntry[]): Promise<BundleManifest>;
/**
 * Store a bundle manifest in the distributed cache.
 */
export declare function storeBundleManifest(manifest: BundleManifest): Promise<void>;
/**
 * Load a bundle manifest from the distributed cache.
 */
export declare function loadBundleManifest(manifestId: string): Promise<BundleManifest | null>;
/**
 * Validate that ALL bundles in a manifest group exist on the local filesystem.
 * If bundles are missing, attempts to recover them from distributed cache.
 *
 * This is the core safety check: if any bundle is missing after recovery attempts,
 * the transform should be re-computed rather than returning a 500 error.
 */
export declare function validateBundleGroup(manifestId: string, cacheDir: string): Promise<ManifestValidationResult>;
/**
 * Get the manifest ID associated with a bundle hash (for TTL co-refresh).
 */
export declare function getManifestIdForHash(hash: string): string | undefined;
/**
 * Refresh the TTL of a manifest in the distributed cache.
 */
export declare function refreshManifestTTL(manifestId: string): Promise<void>;
//# sourceMappingURL=bundle-manifest.d.ts.map