
import type { AppRouteInfo, BuildStats, RouteInfo } from "../../server/build-types.ts";
import { bundlerLogger } from "@veryfront/utils";

interface ChunkManifest {
  version: string;
  routes: Record<string, { chunks: string[] }>;
  chunks: Record<string, unknown>;
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

  if (typeof m.version !== "string") return false;
  if (!m.routes || typeof m.routes !== "object") return false;
  if (!m.chunks || typeof m.chunks !== "object") return false;
  if (!Array.isArray(m.shared)) return false;

  return true;
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
        chunks: enableSplitting && validatedManifest
          ? validatedManifest.routes[r.path]?.chunks || []
          : [],
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