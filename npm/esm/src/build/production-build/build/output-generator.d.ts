/**
 * Output Generator Module
 *
 * Handles generation of build output files:
 * - Client runtime scripts (app.js, client.js, router.js, prefetch.js)
 * - Build manifest
 * - Service worker
 * - Redirects file
 * - Static asset copying
 */
import type { RuntimeAdapter } from "../../../platform/adapters/base.js";
import type { ChunkManifest } from "../../bundler/index.js";
import type { AppRouteInfo, BuildStats, RouteInfo } from "../../../server/build-types.js";
export interface OutputGeneratorOptions {
    adapter: RuntimeAdapter;
    projectDir: string;
    outputDir: string;
    routes: RouteInfo[];
    appRoutes: AppRouteInfo[];
    stats: BuildStats;
    enableSplitting: boolean;
    enablePrefetch: boolean;
    enableCompression: boolean;
    chunkManifest: ChunkManifest | null;
    dryRun: boolean;
}
/**
 * Generate client runtime scripts
 */
export declare function generateClientScripts(adapter: RuntimeAdapter, outputDir: string, dryRun: boolean): Promise<void>;
/**
 * Generate manifest and service worker
 */
export declare function generateManifestAndServiceWorker(options: OutputGeneratorOptions): Promise<void>;
/**
 * Generate redirects file
 */
export declare function generateRedirectsFile(adapter: RuntimeAdapter, outputDir: string, dryRun: boolean): Promise<void>;
/**
 * Copy static assets and return statistics
 */
export declare function copyAssets(adapter: RuntimeAdapter, projectDir: string, outputDir: string, dryRun: boolean): Promise<{
    assets: number;
    totalSize: number;
}>;
/**
 * Generate all output files
 */
export declare function generateAllOutputs(options: OutputGeneratorOptions): Promise<void>;
//# sourceMappingURL=output-generator.d.ts.map