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
} from "./types.ts";

export { CodeSplitter } from "./splitter.ts";

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

import type { ChunkManifest, SplitOptions } from "./types.ts";
import { CodeSplitter } from "./splitter.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";

export function createCodeSplitter(options: SplitOptions): CodeSplitter {
  return new CodeSplitter(options);
}

export async function loadChunkManifest(manifestPath: string): Promise<ChunkManifest> {
  const fs = createFileSystem();
  const content = await fs.readTextFile(manifestPath);

  try {
    return JSON.parse(content) as ChunkManifest;
  } catch {
    throw new Error(`Failed to parse chunk manifest: ${manifestPath}`);
  }
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

  const links = [
    `<link rel="modulepreload" href="${prefix}${route.entry}">`,
    ...(route.preload ?? []).map(
      (chunk) => `<link rel="modulepreload" href="${prefix}${chunk}">`,
    ),
    ...(route.css ?? []).map(
      (css) => `<link rel="preload" as="style" href="${prefix}${css}">`,
    ),
  ];

  return links.join("\n");
}
