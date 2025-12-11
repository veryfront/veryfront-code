
import { serverLogger as logger } from "@veryfront/utils";
import { join } from "node:path";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/index.ts";
import type { ChunkManifest } from "@veryfront/build/bundler/index.ts";
import type { AppRouteInfo, BuildStats, RouteInfo } from "@veryfront/server/build-types.ts";
import { generateServiceWorker } from "@veryfront/server/build-service-worker.ts";
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

export async function generateManifestAndServiceWorker(
  adapter: RuntimeAdapter,
  outputDir: string,
  routes: RouteInfo[],
  appRoutes: AppRouteInfo[],
  stats: BuildStats,
  enableSplitting: boolean,
  enablePrefetch: boolean,
  enableCompression: boolean,
  chunkManifest: ChunkManifest | null,
  dryRun: boolean,
): Promise<void> {
  const manifest = generateManifest({
    routes,
    appRoutes,
    stats,
    enableSplitting,
    enablePrefetch,
    enableCompression,
    chunkManifest,
  });

  if (!dryRun) {
    await adapter.fs.writeFile(
      join(outputDir, "_veryfront/manifest.json"),
      JSON.stringify(manifest, null, 2),
    );

    const sw = generateServiceWorker(manifest);
    await adapter.fs.writeFile(join(outputDir, "sw.js"), sw);
  }
}

export async function generateRedirectsFile(
  adapter: RuntimeAdapter,
  outputDir: string,
  dryRun: boolean,
): Promise<void> {
  if (!dryRun) {
    await adapter.fs.writeFile(join(outputDir, "_redirects"), generateRedirects());
  }
}

export async function copyAssets(
  adapter: RuntimeAdapter,
  projectDir: string,
  outputDir: string,
  dryRun: boolean,
): Promise<{ assets: number; totalSize: number }> {
  return await copyStaticAssets(adapter, projectDir, outputDir, dryRun);
}

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

  await generateManifestAndServiceWorker(
    options.adapter,
    options.outputDir,
    options.routes,
    options.appRoutes,
    options.stats,
    options.enableSplitting,
    options.enablePrefetch,
    options.enableCompression,
    options.chunkManifest,
    options.dryRun,
  );

  await generateRedirectsFile(options.adapter, options.outputDir, options.dryRun);
}
