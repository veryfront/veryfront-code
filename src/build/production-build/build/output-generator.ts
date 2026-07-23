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
import { dirname, join } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { ChunkManifest } from "#veryfront/build/bundler/index.ts";
import type { AppRouteInfo, BuildStats, RouteInfo } from "#veryfront/server/build-types.ts";
import { generateServiceWorker } from "#veryfront/server/build-service-worker.ts";
import {
  generateProdHydrationModule,
  getProdHydrationModulePath,
} from "../../../html/hydration-script-builder/prod-scripts.ts";
import { copyStaticAssets } from "../asset-generation.ts";
import {
  generateAppModule,
  generateClientModule,
  generatePrefetchScript,
  generateRouterScript,
} from "../client-runtime.ts";
import { generateLocalReleaseAssetManifest } from "../local-release-assets.ts";
import { generateManifest, generateRedirects } from "../manifest.ts";
import type { ReleaseAssetManifest } from "#veryfront/release-assets/manifest-schema.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { collectStaticRouteOutputPaths } from "../route-output-paths.ts";

/** Inputs for runtime, asset, manifest, service-worker, and redirects output. */
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
  config?: VeryfrontConfig;
  releaseAssetManifest?: ReleaseAssetManifest | null;
}

/**
 * Write every generated client runtime script.
 */
export async function generateClientScripts(
  adapter: RuntimeAdapter,
  outputDir: string,
  dryRun: boolean,
): Promise<void> {
  logger.info("Copying client scripts...");

  if (dryRun) return;

  await writeOutputFile(adapter, join(outputDir, "_veryfront/app.js"), generateAppModule());
  await writeOutputFile(
    adapter,
    join(outputDir, "_veryfront/client.js"),
    await generateClientModule(),
  );
  await writeOutputFile(
    adapter,
    join(outputDir, "_veryfront/router.js"),
    await generateRouterScript(adapter),
  );
  await writeOutputFile(
    adapter,
    join(outputDir, "_veryfront/prefetch.js"),
    await generatePrefetchScript(adapter),
  );
  const hydrationRuntime = generateProdHydrationModule();
  await writeOutputFile(
    adapter,
    join(outputDir, "_veryfront/hydration-runtime.js"),
    hydrationRuntime,
  );
  await writeOutputFile(
    adapter,
    join(outputDir, getProdHydrationModulePath().slice(1)),
    hydrationRuntime,
  );
}

async function writeOutputFile(
  adapter: RuntimeAdapter,
  path: string,
  content: string,
): Promise<void> {
  await adapter.fs.mkdir(dirname(path), { recursive: true });
  await adapter.fs.writeFile(path, content);
}

/**
 * Validate and write the build manifest and service worker.
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
 * Write the static-host redirects file.
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
 * Copy public assets and return their statistics.
 */
export function copyAssets(
  adapter: RuntimeAdapter,
  projectDir: string,
  outputDir: string,
  dryRun: boolean,
  reservedOutputPaths: Iterable<string> = [],
): Promise<{ assets: number; totalSize: number }> {
  return copyStaticAssets(adapter, projectDir, outputDir, dryRun, reservedOutputPaths);
}

/**
 * Generate all output files
 */
/** Generate every non-route output for a production build. */
export async function generateAllOutputs(options: OutputGeneratorOptions): Promise<void> {
  const { adapter, projectDir, outputDir, dryRun, stats, config, releaseAssetManifest } = options;

  await generateClientScripts(adapter, outputDir, dryRun);
  if (releaseAssetManifest === undefined) {
    await generateLocalReleaseAssetManifest({
      adapter,
      projectDir,
      outputDir,
      dryRun,
      config,
    });
  }

  const reservedOutputPaths = collectStaticRouteOutputPaths(
    options.routes,
    options.appRoutes,
    outputDir,
  );
  const assetStats = await copyAssets(
    adapter,
    projectDir,
    outputDir,
    dryRun,
    reservedOutputPaths,
  );
  stats.assets = assetStats.assets;
  stats.totalSize += assetStats.totalSize;

  await generateManifestAndServiceWorker(options);
  await generateRedirectsFile(adapter, outputDir, dryRun);
}
