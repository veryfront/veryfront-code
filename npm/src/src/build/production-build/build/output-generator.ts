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

import { serverLogger as logger } from "../../../utils/index.js";
import { join } from "../../../platform/compat/path/index.js";
// Direct import from base.ts to avoid circular dependency through barrel
import type { RuntimeAdapter } from "../../../platform/adapters/base.js";
import type { ChunkManifest } from "../../bundler/index.js";
import type { AppRouteInfo, BuildStats, RouteInfo } from "../../../server/build-types.js";
import { generateServiceWorker } from "../../../server/build-service-worker.js";
import { copyStaticAssets } from "../asset-generation.js";
import {
  generateAppModule,
  generateClientModule,
  generatePrefetchScript,
  generateRouterScript,
} from "../client-runtime.js";
import { generateManifest, generateRedirects } from "../manifest.js";

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
export async function generateClientScripts(
  adapter: RuntimeAdapter,
  outputDir: string,
  dryRun: boolean,
): Promise<void> {
  logger.info("Copying client scripts...");

  if (dryRun) return;

  await adapter.fs.writeFile(join(outputDir, "_veryfront/app.js"), generateAppModule());

  await adapter.fs.writeFile(join(outputDir, "_veryfront/client.js"), await generateClientModule());

  await adapter.fs.writeFile(
    join(outputDir, "_veryfront/router.js"),
    await generateRouterScript(adapter),
  );

  await adapter.fs.writeFile(
    join(outputDir, "_veryfront/prefetch.js"),
    await generatePrefetchScript(adapter),
  );
}

/**
 * Generate manifest and service worker
 */
export async function generateManifestAndServiceWorker(
  options: OutputGeneratorOptions,
): Promise<void> {
  const manifest = generateManifest({
    routes: options.routes,
    appRoutes: options.appRoutes,
    stats: options.stats,
    enableSplitting: options.enableSplitting,
    enablePrefetch: options.enablePrefetch,
    enableCompression: options.enableCompression,
    chunkManifest: options.chunkManifest,
  });

  if (options.dryRun) return;

  await options.adapter.fs.writeFile(
    join(options.outputDir, "_veryfront/manifest.json"),
    JSON.stringify(manifest, null, 2),
  );

  await options.adapter.fs.writeFile(
    join(options.outputDir, "sw.js"),
    generateServiceWorker(manifest),
  );
}

/**
 * Generate redirects file
 */
export async function generateRedirectsFile(
  adapter: RuntimeAdapter,
  outputDir: string,
  dryRun: boolean,
): Promise<void> {
  if (dryRun) return;
  await adapter.fs.writeFile(join(outputDir, "_redirects"), generateRedirects());
}

/**
 * Copy static assets and return statistics
 */
export function copyAssets(
  adapter: RuntimeAdapter,
  projectDir: string,
  outputDir: string,
  dryRun: boolean,
): Promise<{ assets: number; totalSize: number }> {
  return copyStaticAssets(adapter, projectDir, outputDir, dryRun);
}

/**
 * Generate all output files
 */
export async function generateAllOutputs(options: OutputGeneratorOptions): Promise<void> {
  await generateClientScripts(options.adapter, options.outputDir, options.dryRun);

  const assetStats = await copyAssets(
    options.adapter,
    options.projectDir,
    options.outputDir,
    options.dryRun,
  );

  options.stats.assets = assetStats.assets;
  options.stats.totalSize += assetStats.totalSize;

  await generateManifestAndServiceWorker(options);
  await generateRedirectsFile(options.adapter, options.outputDir, options.dryRun);
}
