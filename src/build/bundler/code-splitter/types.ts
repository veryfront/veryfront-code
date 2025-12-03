/**
 * Type definitions for code splitting functionality
 * @module code-splitter/types
 */

import type { Metafile } from "esbuild/mod.js";

/**
 * Type alias for esbuild metafile output structure
 */
export type MetafileOutput = Metafile["outputs"][string];

/**
 * Configuration options for code splitting
 */
export interface SplitOptions {
  /** Project root directory */
  projectDir: string;
  /** Output directory for bundled files */
  outDir: string;
  /** Build mode */
  mode: "development" | "production";
  /** Routes to split into separate entry points */
  routes: Array<{
    path: string;
    file: string;
    name?: string;
  }>;
  /** Shared dependencies to bundle separately */
  shared?: string[];
  /** External packages to exclude from bundle */
  external?: string[];
  /** Module resolution strategy for veryfront/ai modules */
  moduleResolution?: "cdn" | "self-hosted" | "bundled";
}

/**
 * Result of code splitting operation
 */
export interface SplitResult {
  /** Entry chunks (one per route) */
  entries: Map<string, ChunkInfo>;
  /** Shared chunks used across multiple routes */
  shared: Map<string, ChunkInfo>;
  /** Manifest for runtime chunk loading */
  manifest: ChunkManifest;
}

/**
 * Metadata for a single chunk
 */
export interface ChunkInfo {
  /** Chunk name (without extension) */
  name: string;
  /** Relative file path */
  file: string;
  /** Imported chunk dependencies */
  imports: string[];
  /** Associated CSS file (if any) */
  css?: string;
  /** File size in bytes */
  size: number;
  /** Content hash for cache busting */
  hash: string;
}

/**
 * Complete manifest of all chunks and routes
 */
export interface ChunkManifest {
  /** Manifest format version */
  version: string;
  /** Route to chunk mapping */
  routes: Record<string, RouteChunkInfo>;
  /** All chunks in the build */
  chunks: Record<string, ChunkInfo>;
  /** List of shared chunk paths */
  shared: string[];
}

/**
 * Chunk information for a specific route
 */
export interface RouteChunkInfo {
  /** Main entry chunk for this route */
  entry: string;
  /** Dependent chunks required by this route */
  chunks: string[];
  /** CSS files for this route */
  css?: string[];
  /** Critical chunks to preload */
  preload?: string[];
}
