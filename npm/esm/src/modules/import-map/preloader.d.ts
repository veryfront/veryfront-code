/**
 * Import Map Preloader
 *
 * Caches import maps to avoid repeated loading during layout application.
 * When multiple MDX layouts need the import map, this ensures it's only
 * loaded once per project directory.
 */
import type { RuntimeAdapter } from "../../platform/adapters/base.js";
import type { ImportMapConfig } from "./types.js";
/**
 * Preload and cache import map for a project directory.
 *
 * This ensures the import map is only loaded once per project,
 * even when multiple MDX layouts request it concurrently.
 *
 * @param projectDir The project directory path
 * @param adapter Runtime adapter for file system access
 * @returns The loaded import map configuration
 */
export declare function preloadImportMap(projectDir: string, adapter: RuntimeAdapter): Promise<ImportMapConfig>;
/**
 * Get import map from cache if available, or return undefined.
 *
 * @param projectDir The project directory path
 * @returns The cached import map or undefined if not cached
 */
export declare function getCachedImportMap(projectDir: string): Promise<ImportMapConfig | undefined>;
/**
 * Clear import map cache for a specific project or all projects.
 *
 * @param projectDir Optional project directory to clear. If not provided, clears all.
 */
export declare function clearImportMapCache(projectDir?: string): void;
//# sourceMappingURL=preloader.d.ts.map