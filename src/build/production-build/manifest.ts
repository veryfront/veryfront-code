import type { AppRouteInfo, BuildStats, RouteInfo } from "#veryfront/server/build-types.ts";
import { type ChunkManifest, isChunkManifest } from "#veryfront/build/bundler/index.ts";

export const BUILD_MANIFEST_VERSION = "2.0.0";
export type ManifestChunkInfo = ChunkManifest["chunks"][string];

/** Versioned description of generated routes, chunks, features, and statistics. */
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

/** Inputs used to assemble and validate a build manifest. */
export interface ManifestOptions {
  routes: RouteInfo[];
  appRoutes: AppRouteInfo[];
  stats: BuildStats;
  enableSplitting: boolean;
  enablePrefetch: boolean;
  enableCompression: boolean;
  chunkManifest: ChunkManifest | null;
}

function validateBuildStats(stats: BuildStats): void {
  for (
    const [name, value] of Object.entries({
      pages: stats.pages,
      chunks: stats.chunks,
      assets: stats.assets,
      totalSize: stats.totalSize,
    })
  ) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(`Build statistic ${name} must be a non-negative integer`);
    }
  }
}

function validateRoute(path: string, slug: string): void {
  if (
    !path.startsWith("/") || path.includes("\0") || path.includes("\\") ||
    path.split("/").some((segment) => segment === "..")
  ) {
    throw new TypeError("Build manifest routes must use safe absolute URL paths");
  }
  if (!slug || slug.includes("\0")) {
    throw new TypeError("Build manifest route slugs must not be blank");
  }
}

/** Validate build metadata and create a detached build manifest. */
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

  validateBuildStats(stats);
  if (chunkManifest && !isChunkManifest(chunkManifest)) {
    throw new TypeError("Invalid chunk manifest structure");
  }
  const validatedManifest = chunkManifest ?? null;
  const generatedPaths = stats.ssgPaths ? new Set(stats.ssgPaths) : null;
  const generatedRoutes = generatedPaths
    ? routes.filter((route) => generatedPaths.has(route.path))
    : routes;
  const generatedAppRoutes = generatedPaths
    ? appRoutes.filter((route) => generatedPaths.has(route.path))
    : appRoutes;

  const routePaths = new Set<string>();
  for (const route of generatedRoutes) {
    validateRoute(route.path, route.slug);
    if (routePaths.has(route.path)) {
      throw new TypeError(`Duplicate build manifest route: ${route.path}`);
    }
    routePaths.add(route.path);
  }
  for (const route of generatedAppRoutes) {
    const slug = route.path === "/" ? "index" : route.path.slice(1);
    validateRoute(route.path, slug);
    if (routePaths.has(route.path)) {
      throw new TypeError(`Duplicate build manifest route: ${route.path}`);
    }
    routePaths.add(route.path);
  }

  const activeChunkManifest = enableSplitting ? validatedManifest : null;

  function getChunksForRoute(path: string): string[] {
    if (!activeChunkManifest) return [];
    const route = Object.hasOwn(activeChunkManifest.routes, path)
      ? activeChunkManifest.routes[path]
      : undefined;
    return route ? [...route.chunks] : [];
  }

  return {
    version: BUILD_MANIFEST_VERSION,
    buildTime: new Date().toISOString(),
    features: {
      streaming: true,
      codeSplitting: activeChunkManifest !== null,
      clientRouting: true,
      prefetching: enablePrefetch,
      compression: enableCompression,
    },
    routes: [
      ...generatedRoutes.map((r) => ({
        path: r.path,
        slug: r.slug,
        chunks: getChunksForRoute(r.path),
      })),
      ...generatedAppRoutes.map((r) => ({
        path: r.path,
        slug: r.path === "/" ? "index" : r.path.slice(1),
        chunks: [],
      })),
    ],
    chunks: activeChunkManifest,
    stats: {
      pages: stats.pages,
      chunks: stats.chunks,
      assets: stats.assets,
      totalSize: `${(stats.totalSize / 1024 / 1024).toFixed(2)} MB`,
    },
  };
}

/** Return the static-host redirect rule used for client-side routing. */
export function generateRedirects(): string {
  return `
# SPA support - all routes go to index.html
/*    /index.html   200
`;
}
