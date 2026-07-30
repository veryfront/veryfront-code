import { serverLogger } from "#veryfront/utils";
import { buildAppRoutes, buildPagesRoutes } from "../static-generation.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import type { VeryfrontRenderer } from "#veryfront/rendering/index.ts";
import type { AppRouteInfo, RouteInfo } from "#veryfront/server/build-types.ts";
import type { ChunkManifest } from "#veryfront/build/bundler/index.ts";
import type { ReleaseAssetManifest } from "#veryfront/release-assets/manifest-schema.ts";
import {
  createDependencyPinningSource,
  resolveDependencyPinningSnapshot,
} from "#veryfront/transforms/esm/package-registry.ts";

const logger = serverLogger.component("build");

export interface BuildExecutorOptions {
  adapter: RuntimeAdapter;
  projectDir: string;
  outputDir: string;
  renderer: VeryfrontRenderer;
  config: VeryfrontConfig;
  enablePrefetch: boolean;
  chunkManifest: ChunkManifest | null;
  baseUrl: string;
  dryRun: boolean;
  releaseAssetManifest?: ReleaseAssetManifest | null;
  /** Select adapter-backed package reads for virtual/proxy build sources. */
  isLocalProject?: boolean;
  dependencyPinningCacheKey?: string;
  dependencyPinningDependencies?: Readonly<Record<string, string>>;
}

export interface BuildResult {
  pages: number;
  totalSize: number;
  ssgPaths: string[];
}

export async function executeBuild(
  pagesRoutes: RouteInfo[],
  appRoutes: AppRouteInfo[],
  options: BuildExecutorOptions,
): Promise<BuildResult> {
  logger.debug(
    `[BUILD] executeBuild: ${pagesRoutes.length} pages routes, ${appRoutes.length} app routes`,
  );

  const dependencySnapshot = await resolveDependencyPinningSnapshot(
    createDependencyPinningSource({
      projectDir: options.projectDir,
      adapter: options.adapter,
      isLocalProject: options.isLocalProject,
      contentSourceId: "production-build",
      config: options.config,
    }),
    options.dependencyPinningCacheKey,
    options.dependencyPinningDependencies,
  );
  const buildOptions: BuildExecutorOptions = {
    ...options,
    dependencyPinningCacheKey: dependencySnapshot.cacheKey,
    dependencyPinningDependencies: dependencySnapshot.dependencies,
  };

  logger.debug("Building pages...");
  const pagesStats = await buildPagesRoutes(pagesRoutes, buildOptions);
  logger.debug(`pagesStats: ${pagesStats.pages} pages built`);

  const appStats = await buildAppRoutes(appRoutes, buildOptions);
  logger.debug(`appStats: ${appStats.pages} pages built`);

  return {
    pages: pagesStats.pages + appStats.pages,
    totalSize: pagesStats.totalSize + appStats.totalSize,
    ssgPaths: [...pagesStats.ssgPaths, ...appStats.ssgPaths],
  };
}
