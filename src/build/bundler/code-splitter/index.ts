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
import { BUILD_FAILED } from "#veryfront/errors";
import { escapeHTML } from "#veryfront/html";
import { isChunkManifest, MAX_CHUNK_MANIFEST_BYTES } from "./manifest-validation.ts";
export { isChunkManifest } from "./manifest-validation.ts";

export function createCodeSplitter(options: SplitOptions): CodeSplitter {
  return new CodeSplitter(options);
}

export async function loadChunkManifest(manifestPath: string): Promise<ChunkManifest> {
  if (typeof manifestPath !== "string" || !manifestPath.trim()) {
    throw new TypeError("Chunk manifest path must not be blank");
  }
  const fs = createFileSystem();
  const info = await fs.stat(manifestPath);
  if (
    !info.isFile || !Number.isSafeInteger(info.size) || info.size < 0 ||
    info.size > MAX_CHUNK_MANIFEST_BYTES
  ) {
    throw BUILD_FAILED.create({ detail: "Invalid chunk manifest structure" });
  }
  const content = await fs.readTextFile(manifestPath);

  try {
    if (new TextEncoder().encode(content).byteLength > MAX_CHUNK_MANIFEST_BYTES) {
      throw new TypeError("Chunk manifest exceeds the size limit");
    }
    const manifest: unknown = JSON.parse(content);
    if (!isChunkManifest(manifest)) {
      throw new TypeError("Invalid chunk manifest structure");
    }
    return manifest;
  } catch {
    throw BUILD_FAILED.create({ detail: "Invalid chunk manifest structure" });
  }
}

export function getChunksForRoute(manifest: ChunkManifest, routePath: string): string[] {
  const route = Object.hasOwn(manifest.routes, routePath) ? manifest.routes[routePath] : undefined;
  if (!route) return [];

  return [...new Set([...(route.css ?? []), route.entry, ...route.chunks])];
}

export function generatePreloadLinks(
  manifest: ChunkManifest,
  routePath: string,
  baseUrl = "",
): string {
  const route = Object.hasOwn(manifest.routes, routePath) ? manifest.routes[routePath] : undefined;
  if (!route) return "";

  const prefix = baseUrl ? `${baseUrl}/` : "";

  const links = [
    `<link rel="modulepreload" href="${escapeHTML(`${prefix}${route.entry}`)}">`,
    ...(route.preload ?? []).map(
      (chunk) => `<link rel="modulepreload" href="${escapeHTML(`${prefix}${chunk}`)}">`,
    ),
    ...(route.css ?? []).map(
      (css) => `<link rel="preload" as="style" href="${escapeHTML(`${prefix}${css}`)}">`,
    ),
  ];

  return links.join("\n");
}
