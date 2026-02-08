import type { AppRouteInfo, BuildStats, RouteInfo } from "#veryfront/server/build-types.ts";
import { bundlerLogger } from "#veryfront/utils";

export interface ManifestChunkInfo {
  file: string;
  css?: string;
  imports?: string[];
}

interface ChunkManifest {
  version: string;
  routes: Record<string, { chunks: string[] }>;
  chunks: Record<string, ManifestChunkInfo>;
  shared: string[];
}

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

export interface ManifestOptions {
  routes: RouteInfo[];
  appRoutes: AppRouteInfo[];
  stats: BuildStats;
  enableSplitting: boolean;
  enablePrefetch: boolean;
  enableCompression: boolean;
  chunkManifest: ChunkManifest | null;
}

function isValidChunkManifest(manifest: unknown): manifest is ChunkManifest {
  if (!manifest || typeof manifest !== "object") return false;

  const m = manifest as Record<string, unknown>;
  return (
    typeof m.version === "string" &&
    typeof m.routes === "object" &&
    m.routes !== null &&
    typeof m.chunks === "object" &&
    m.chunks !== null &&
    Array.isArray(m.shared)
  );
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

  const validatedManifest = chunkManifest && isValidChunkManifest(chunkManifest)
    ? chunkManifest
    : null;

  if (chunkManifest && !validatedManifest) {
    bundlerLogger.warn("Invalid chunk manifest structure, chunks will be disabled");
  }

  function getChunksForRoute(path: string): string[] {
    if (!enableSplitting || !validatedManifest) return [];
    return validatedManifest.routes[path]?.chunks ?? [];
  }

  return {
    version: "2.0.0",
    buildTime: new Date().toISOString(),
    features: {
      streaming: true,
      codeSplitting: enableSplitting,
      clientRouting: true,
      prefetching: enablePrefetch,
      compression: enableCompression,
    },
    routes: [
      ...routes.map((r) => ({
        path: r.path,
        slug: r.slug,
        chunks: getChunksForRoute(r.path),
      })),
      ...appRoutes.map((r) => ({
        path: r.path,
        slug: r.path === "/" ? "index" : r.path.slice(1),
        chunks: [],
      })),
    ],
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
