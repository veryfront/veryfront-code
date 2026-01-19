/**
 * Build Manifest Generation
 * Handles generation of build manifest and _redirects file
 */

import type { AppRouteInfo, BuildStats, RouteInfo } from "../../server/build-types.ts";
import { bundlerLogger } from "#veryfront/utils";

/** Chunk info for service worker and manifest generation */
export interface ManifestChunkInfo {
  file: string;
  css?: string;
  imports?: string[];
}

// Stub type for ChunkManifest - mirrors code-splitter/types.ts
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

/**
 * Validates chunk manifest structure
 */
function isValidChunkManifest(manifest: unknown): manifest is ChunkManifest {
  if (!manifest || typeof manifest !== "object") return false;
  const m = manifest as Record<string, unknown>;

  // Check required fields
  if (typeof m.version !== "string") return false;
  if (!m.routes || typeof m.routes !== "object") return false;
  if (!m.chunks || typeof m.chunks !== "object") return false;
  if (!Array.isArray(m.shared)) return false;

  return true;
}

/**
 * Generate build manifest
 */
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

  // Validate chunk manifest if provided
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
      // App routes do not produce chunks currently
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

/**
 * Generate _redirects file for SPA support
 */
export function generateRedirects(): string {
  return `
# SPA support - all routes go to index.html
/*    /index.html   200
`;
}
