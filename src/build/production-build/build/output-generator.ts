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
import type { RuntimeAdapter } from "#veryfront/platform/adapters/index.ts";
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

  if (!dryRun) {
    await adapter.fs.writeFile(join(outputDir, "_veryfront/app.js"), generateAppModule());

    await adapter.fs.writeFile(
      join(outputDir, "_veryfront/client.js"),
      await generateClientModule(),
    );

    await adapter.fs.writeFile(
      join(outputDir, "_veryfront/router.js"),
      await generateRouterScript(adapter),
    );

    await adapter.fs.writeFile(
      join(outputDir, "_veryfront/prefetch.js"),
      await generatePrefetchScript(adapter),
    );
  }
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

  if (!options.dryRun) {
    await options.adapter.fs.writeFile(
      join(options.outputDir, "_veryfront/manifest.json"),
      JSON.stringify(manifest, null, 2),
    );

    const sw = generateServiceWorker(manifest);
    await options.adapter.fs.writeFile(join(options.outputDir, "sw.js"), sw);
  }
}

/**
 * Generate redirects file
 */
export async function generateRedirectsFile(
  adapter: RuntimeAdapter,
  outputDir: string,
  dryRun: boolean,
): Promise<void> {
  if (!dryRun) {
    await adapter.fs.writeFile(join(outputDir, "_redirects"), generateRedirects());
  }
}

/**
 * Copy static assets and return statistics
 */
export async function copyAssets(
  adapter: RuntimeAdapter,
  projectDir: string,
  outputDir: string,
  dryRun: boolean,
): Promise<{ assets: number; totalSize: number }> {
  return await copyStaticAssets(adapter, projectDir, outputDir, dryRun);
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
