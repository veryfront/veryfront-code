import type { AppRouteInfo, BuildStats, RouteInfo } from "#veryfront/server/build-types.ts";
import {
  type ChunkInfo,
  type ChunkManifest,
  validateChunkManifest,
} from "#veryfront/build/bundler/index.ts";
import { BUILD_FAILED } from "#veryfront/errors";
import { PRODUCTION_BUILD_FORMAT_VERSION } from "./constants.ts";

export type ManifestChunkInfo = ChunkInfo;

export interface BuildManifest {
  version: string;
  buildTime: string;
  features: {
    streaming: boolean;
    codeSplitting: boolean;
    clientRouting: boolean;
    prefetching: boolean;
    compression: boolean;
  };
  routes: Array<{
    path: string;
    template: string;
    slug: string;
    chunks: string[];
  }>;
  chunks: ChunkManifest | null;
  stats: {
    pages: number;
    chunks: number;
    assets: number;
    totalSize: string;
  };
}

export interface ManifestOptions {
  routes: RouteInfo[];
  appRoutes: AppRouteInfo[];
  stats: BuildStats;
  enableSplitting: boolean;
  enablePrefetch: boolean;
  enableCompression: boolean;
  chunkManifest: ChunkManifest | null;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalizeChunkManifest(manifest: ChunkManifest): ChunkManifest {
  const chunks = Object.fromEntries(
    Object.entries(manifest.chunks)
      .sort(([left], [right]) => compareText(left, right))
      .map(([path, chunk]) => [
        path,
        {
          name: chunk.name,
          file: chunk.file,
          imports: [...chunk.imports].sort(compareText),
          ...(chunk.css === undefined ? {} : { css: chunk.css }),
          size: chunk.size,
          hash: chunk.hash,
        },
      ]),
  );
  const routes = Object.fromEntries(
    Object.entries(manifest.routes)
      .sort(([left], [right]) => compareText(left, right))
      .map(([path, route]) => [
        path,
        {
          entry: route.entry,
          chunks: [...route.chunks].sort(compareText),
          ...(route.css === undefined ? {} : { css: [...route.css].sort(compareText) }),
          ...(route.preload === undefined ? {} : { preload: [...route.preload].sort(compareText) }),
        },
      ]),
  );

  return {
    version: manifest.version,
    routes,
    chunks,
    shared: [...manifest.shared].sort(compareText),
  };
}

function assertNonNegativeSafeInteger(value: number, description: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw BUILD_FAILED.create({
      detail: `${description} must be a non-negative safe integer`,
    });
  }
}

function validateManifestStats(stats: BuildStats): void {
  assertNonNegativeSafeInteger(stats.pages, "Build page count");
  assertNonNegativeSafeInteger(stats.chunks, "Build chunk count");
  assertNonNegativeSafeInteger(stats.assets, "Build asset count");
  if (!Number.isFinite(stats.totalSize) || stats.totalSize < 0) {
    throw BUILD_FAILED.create({
      detail: "Build total size must be a finite non-negative number",
    });
  }
}

function requireValidChunkManifest(
  manifest: ChunkManifest | null,
  enableSplitting: boolean,
): ChunkManifest | null {
  if (manifest === null) return null;
  if (!enableSplitting) {
    throw BUILD_FAILED.create({
      detail: "A chunk manifest was produced while code splitting was disabled",
    });
  }

  try {
    return canonicalizeChunkManifest(validateChunkManifest(manifest));
  } catch (error) {
    throw BUILD_FAILED.create({
      detail: "Invalid chunk manifest produced by the build",
      cause: error,
    });
  }
}

function assertManifestConsistency(options: {
  generatedRoutePaths: Set<string>;
  generatedPageChunkPaths: Set<string>;
  stats: BuildStats;
  chunkManifest: ChunkManifest | null;
}): void {
  const { generatedRoutePaths, generatedPageChunkPaths, stats, chunkManifest } = options;
  if (generatedRoutePaths.size !== stats.pages) {
    throw BUILD_FAILED.create({
      detail: `Build generated ${stats.pages} pages but the output manifest contains ` +
        `${generatedRoutePaths.size} routes`,
    });
  }

  const chunkCount = chunkManifest ? Object.keys(chunkManifest.chunks).length : 0;
  if (chunkCount !== stats.chunks) {
    throw BUILD_FAILED.create({
      detail: `Build reported ${stats.chunks} chunks but the chunk manifest contains ` +
        `${chunkCount} chunks`,
    });
  }

  if (!chunkManifest) return;
  for (const routePath of Object.keys(chunkManifest.routes)) {
    if (!generatedPageChunkPaths.has(routePath)) {
      throw BUILD_FAILED.create({
        detail: `Chunk manifest references a route that was not generated: ${routePath}`,
      });
    }
  }
}

export function generateManifest(options: ManifestOptions): BuildManifest {
  const {
    routes,
    appRoutes,
    stats,
    enableSplitting,
    enablePrefetch,
    enableCompression,
    chunkManifest,
  } = options;

  validateManifestStats(stats);
  const validatedManifest = requireValidChunkManifest(chunkManifest, enableSplitting);
  const generatedPaths = stats.ssgPaths ? new Set(stats.ssgPaths) : null;
  const generatedRoutes = generatedPaths
    ? routes.filter((route) => generatedPaths.has(route.path))
    : routes;
  const generatedAppRoutes = generatedPaths
    ? appRoutes.filter((route) => generatedPaths.has(route.path))
    : appRoutes;
  const generatedPagePaths = new Set(generatedRoutes.map((route) => route.path));
  const generatedPageChunkPaths = new Set(
    generatedRoutes.map((route) => route.templatePath ?? route.path),
  );
  const generatedRoutePaths = new Set([
    ...generatedPagePaths,
    ...generatedAppRoutes.map((route) => route.path),
  ]);
  assertManifestConsistency({
    generatedRoutePaths,
    generatedPageChunkPaths,
    stats,
    chunkManifest: validatedManifest,
  });

  function getChunksForRoute(path: string): string[] {
    if (!enableSplitting || !validatedManifest) return [];
    return [...(validatedManifest.routes[path]?.chunks ?? [])];
  }

  const manifestRoutes = [
    ...generatedRoutes.map((route) => ({
      path: route.path,
      template: route.templatePath ?? route.path,
      slug: route.slug,
      chunks: getChunksForRoute(route.templatePath ?? route.path),
    })),
    ...generatedAppRoutes.map((route) => ({
      path: route.path,
      template: route.path,
      slug: route.path === "/" ? "index" : route.path.slice(1),
      chunks: [],
    })),
  ].sort((left, right) => compareText(left.path, right.path));

  return {
    version: PRODUCTION_BUILD_FORMAT_VERSION,
    buildTime: new Date().toISOString(),
    features: {
      streaming: true,
      codeSplitting: enableSplitting,
      clientRouting: true,
      prefetching: enablePrefetch,
      compression: enableCompression,
    },
    routes: manifestRoutes,
    chunks: validatedManifest,
    stats: {
      pages: stats.pages,
      chunks: stats.chunks,
      assets: stats.assets,
      totalSize: `${(stats.totalSize / 1024 / 1024).toFixed(2)} MB`,
    },
  };
}

export function generateRedirects(): string {
  return `
# SPA support - all routes go to index.html
/*    /index.html   200
`;
}
