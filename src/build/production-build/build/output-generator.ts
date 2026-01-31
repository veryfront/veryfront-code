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

import { serverLogger as logger } from "#veryfront/utils";
import { join } from "#veryfront/platform/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { ChunkManifest } from "#veryfront/build/bundler/index.ts";
import type { AppRouteInfo, BuildStats, RouteInfo } from "#veryfront/server/build-types.ts";
import { generateServiceWorker } from "#veryfront/server/build-service-worker.ts";
import { copyStaticAssets } from "../asset-generation.ts";
import {
  generateAppModule,
  generateClientModule,
  generatePrefetchScript,
  generateRouterScript,
} from "../client-runtime.ts";
import { generateManifest, generateRedirects } from "../manifest.ts";

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
  const {
    adapter,
    outputDir,
    routes,
    appRoutes,
    stats,
    enableSplitting,
    enablePrefetch,
    enableCompression,
    chunkManifest,
    dryRun,
  } = options;

  const manifest = generateManifest({
    routes,
    appRoutes,
    stats,
    enableSplitting,
    enablePrefetch,
    enableCompression,
    chunkManifest,
  });

  if (dryRun) return;

  await adapter.fs.writeFile(
    join(outputDir, "_veryfront/manifest.json"),
    JSON.stringify(manifest, null, 2),
  );

  await adapter.fs.writeFile(join(outputDir, "sw.js"), generateServiceWorker(manifest));
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
  const { adapter, projectDir, outputDir, dryRun, stats } = options;

  await generateClientScripts(adapter, outputDir, dryRun);

  const assetStats = await copyAssets(adapter, projectDir, outputDir, dryRun);
  stats.assets = assetStats.assets;
  stats.totalSize += assetStats.totalSize;

  await generateManifestAndServiceWorker(options);
  await generateRedirectsFile(adapter, outputDir, dryRun);
}
