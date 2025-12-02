/**
 * Code splitter public API
 * @module code-splitter
 */

// Re-export types
export type {
  ChunkInfo,
  ChunkManifest,
  MetafileOutput,
  RouteChunkInfo,
  SplitOptions,
  SplitResult,
} from "./types.ts";

// Re-export main class
export { CodeSplitter } from "./splitter.ts";

// Re-export utilities
export { convertPathToName, createEntryPoints } from "./entry-points.ts";
export {
  buildManifest,
  calculateFileHash,
  extractChunkName,
  extractEntryName,
  getChunkInfo,
  getPreloadHints,
  isCriticalImport,
  writeManifest,
} from "./manifest-builder.ts";
export { createBuildContext, createShimFile, getExternalDependencies } from "./build-context.ts";
export { createSplitterPlugin } from "./esbuild-plugin.ts";

// Factory and utility functions
import type { ChunkManifest, SplitOptions } from "./types.ts";
import { CodeSplitter } from "./splitter.ts";
import { createFileSystem } from "../../../platform/compat/fs.ts";

/**
 * Creates a new code splitter instance
 *
 * @param options - Code splitting configuration
 * @returns CodeSplitter instance
 */
export function createCodeSplitter(options: SplitOptions): CodeSplitter {
  return new CodeSplitter(options);
}

/**
 * Loads a chunk manifest from disk
 *
 * @param manifestPath - Path to manifest.json file
 * @returns Parsed chunk manifest
 */
export async function loadChunkManifest(manifestPath: string): Promise<ChunkManifest> {
  const fs = createFileSystem();
  const content = await fs.readTextFile(manifestPath);
  return JSON.parse(content);
}

/**
 * Gets all chunks required for a specific route
 *
 * @param manifest - Chunk manifest
 * @param routePath - Route path to get chunks for
 * @returns Array of chunk paths (CSS, entry, and dependencies)
 */
export function getChunksForRoute(manifest: ChunkManifest, routePath: string): string[] {
  const route = manifest.routes[routePath];
  if (!route) return [];

  const cssFiles = route.css ? route.css : [];
  return [...cssFiles, route.entry, ...route.chunks];
}

/**
 * Generates preload link tags for a route
 *
 * @param manifest - Chunk manifest
 * @param routePath - Route path to generate preloads for
 * @param baseUrl - Base URL for chunk paths (default: '')
 * @returns HTML string with preload link tags
 */
export function generatePreloadLinks(
  manifest: ChunkManifest,
  routePath: string,
  baseUrl = "",
): string {
  const route = manifest.routes[routePath];
  if (!route) return "";

  const preloadLinks = route.preload
    ? route.preload.map((chunk) => `<link rel="modulepreload" href="${baseUrl}/${chunk}">`)
    : [];
  const cssLinks = route.css
    ? route.css.map((css) => `<link rel="preload" as="style" href="${baseUrl}/${css}">`)
    : [];
  const links = [
    `<link rel="modulepreload" href="${baseUrl}/${route.entry}">`,
    ...preloadLinks,
    ...cssLinks,
  ];

  return links.join("\n");
}
