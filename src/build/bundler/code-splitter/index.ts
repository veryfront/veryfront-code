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
import { createFileSystem } from "@veryfront/platform/compat/fs.ts";

/** Creates a new code splitter instance */
export function createCodeSplitter(options: SplitOptions): CodeSplitter {
  return new CodeSplitter(options);
}

/** Loads a chunk manifest from disk */
export async function loadChunkManifest(manifestPath: string): Promise<ChunkManifest> {
  const fs = createFileSystem();
  const content = await fs.readTextFile(manifestPath);
  return JSON.parse(content);
}

/**
 * Gets all chunks required for a specific route
 */
export function getChunksForRoute(manifest: ChunkManifest, routePath: string): string[] {
  const route = manifest.routes[routePath];
  if (!route) return [];

  return [...(route.css ?? []), route.entry, ...route.chunks];
}

/**
 * Generates preload link tags for a route
 */
export function generatePreloadLinks(
  manifest: ChunkManifest,
  routePath: string,
  baseUrl = "",
): string {
  const route = manifest.routes[routePath];
  if (!route) return "";

  const preloadLinks = (route.preload ?? []).map(
    (chunk) => `<link rel="modulepreload" href="${baseUrl}/${chunk}">`,
  );
  const cssLinks = (route.css ?? []).map(
    (css) => `<link rel="preload" as="style" href="${baseUrl}/${css}">`,
  );

  return [
    `<link rel="modulepreload" href="${baseUrl}/${route.entry}">`,
    ...preloadLinks,
    ...cssLinks,
  ].join("\n");
}
