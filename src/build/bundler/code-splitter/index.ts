
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
import { createFileSystem } from "../../../platform/compat/fs.ts";

export function createCodeSplitter(options: SplitOptions): CodeSplitter {
  return new CodeSplitter(options);
}

export async function loadChunkManifest(manifestPath: string): Promise<ChunkManifest> {
  const fs = createFileSystem();
  const content = await fs.readTextFile(manifestPath);
  return JSON.parse(content);
}

export function getChunksForRoute(manifest: ChunkManifest, routePath: string): string[] {
  const route = manifest.routes[routePath];
  if (!route) return [];

  const cssFiles = route.css ? route.css : [];
  return [...cssFiles, route.entry, ...route.chunks];
}

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
