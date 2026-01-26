/**
 * Code splitter public API
 * @module code-splitter
 */

export type {
  ChunkInfo,
  ChunkManifest,
  MetafileOutput,
  RouteChunkInfo,
  SplitOptions,
  SplitResult,
} from "./types.js";

export { CodeSplitter } from "./splitter.js";

export { convertPathToName, createEntryPoints } from "./entry-points.js";
export {
  buildManifest,
  calculateFileHash,
  extractChunkName,
  extractEntryName,
  getChunkInfo,
  getPreloadHints,
  isCriticalImport,
  writeManifest,
} from "./manifest-builder.js";
export { createBuildContext, createShimFile, getExternalDependencies } from "./build-context.js";
export { createSplitterPlugin } from "./esbuild-plugin.js";

import type { ChunkManifest, SplitOptions } from "./types.js";
import { CodeSplitter } from "./splitter.js";
import { createFileSystem } from "../../../platform/compat/fs.js";

export function createCodeSplitter(options: SplitOptions): CodeSplitter {
  return new CodeSplitter(options);
}

export async function loadChunkManifest(manifestPath: string): Promise<ChunkManifest> {
  const fs = createFileSystem();
  const content = await fs.readTextFile(manifestPath);
  return JSON.parse(content) as ChunkManifest;
}

export function getChunksForRoute(manifest: ChunkManifest, routePath: string): string[] {
  const route = manifest.routes[routePath];
  if (!route) return [];

  return [...(route.css ?? []), route.entry, ...route.chunks];
}

export function generatePreloadLinks(
  manifest: ChunkManifest,
  routePath: string,
  baseUrl = "",
): string {
  const route = manifest.routes[routePath];
  if (!route) return "";

  const prefix = baseUrl ? `${baseUrl}/` : "";

  const preloadLinks = (route.preload ?? []).map(
    (chunk) => `<link rel="modulepreload" href="${prefix}${chunk}">`,
  );
  const cssLinks = (route.css ?? []).map(
    (css) => `<link rel="preload" as="style" href="${prefix}${css}">`,
  );

  return [`<link rel="modulepreload" href="${prefix}${route.entry}">`, ...preloadLinks, ...cssLinks]
    .join(
      "\n",
    );
}
