import type { VeryfrontConfig } from "./types.js";
import type { RuntimeAdapter } from "../platform/adapters/base.js";
export type { VeryfrontConfig } from "./types.js";
/**
 * Options for getConfig
 */
export interface GetConfigOptions {
    /**
     * Cache key for virtual filesystem (API-backed) projects.
     * When provided, this is used instead of projectDir for caching.
     * This should be a unique project identifier (e.g., projectId or projectSlug).
     */
    cacheKey?: string;
}
export declare function getConfig(projectDir: string, adapter: RuntimeAdapter, options?: GetConfigOptions): Promise<VeryfrontConfig>;
export declare function clearConfigCache(): void;
/**
 * Synchronous config cache lookup for hot paths.
 *
 * Returns cached config immediately without async overhead.
 * Use this for performance-critical paths when config is likely cached.
 *
 * @returns Cached config if valid, null if not cached or stale
 */
export declare function getCachedConfigSync(projectDir: string): VeryfrontConfig | null;
//# sourceMappingURL=loader.d.ts.map