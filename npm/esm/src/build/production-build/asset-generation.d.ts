/**
 * Asset Generation for Build
 * Handles copying static assets from public directory
 */
import type { RuntimeAdapter } from "../../platform/adapters/base.js";
export interface AssetStats {
    assets: number;
    totalSize: number;
}
/**
 * Copy static assets from public directory to output directory
 */
export declare function copyStaticAssets(adapter: RuntimeAdapter, projectDir: string, outputDir: string, dryRun?: boolean): Promise<AssetStats>;
/**
 * Load CSS template (embedded for npm compatibility)
 */
export declare function loadClientStyles(): string;
//# sourceMappingURL=asset-generation.d.ts.map