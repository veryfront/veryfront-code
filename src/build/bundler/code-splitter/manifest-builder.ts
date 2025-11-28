/**
 * Chunk manifest building and metadata extraction
 * @module code-splitter/manifest-builder
 */

import type { Metafile } from "esbuild/mod.js";
import { join, relative } from "std/path/mod.ts";
import type { ChunkInfo, ChunkManifest, MetafileOutput } from "./types.ts";
import { createError, toError } from "../../../core/errors/veryfront-error.ts";

const IS_DENO = typeof Deno !== "undefined" && "readFile" in Deno;

async function readFileBytes(path: string): Promise<Uint8Array> {
  if (IS_DENO) {
    return await Deno.readFile(path);
  }
  const fs = await import("node:fs/promises");
  const buffer = await fs.readFile(path);
  return new Uint8Array(buffer);
}

async function writeTextFile(path: string, content: string): Promise<void> {
  if (IS_DENO) {
    await Deno.writeTextFile(path, content);
    return;
  }
  const fs = await import("node:fs/promises");
  await fs.writeFile(path, content, "utf8");
}

/**
 * Extracts entry name from entry point path
 *
 * @param entryPoint - Entry point path from metafile
 * @returns Extracted entry name without extension
 */
export function extractEntryName(entryPoint: string): string {
  const filename = entryPoint.split("/").pop();
  if (!filename) {
    throw toError(createError({
      type: "config",
      message: `Invalid entry point path: ${entryPoint}`,
    }));
  }
  return filename.replace(/\.(ts|tsx|js|jsx|mdx)$/, "")
    ? filename.replace(/\.(ts|tsx|js|jsx|mdx)$/, "")
    : "unknown";
}

/**
 * Extracts chunk name from file path
 *
 * @param file - File path
 * @returns Chunk name without extension
 */
export function extractChunkName(file: string): string {
  const base = file.split("/").pop();
  if (!base) {
    throw toError(createError({
      type: "config",
      message: `Invalid chunk file path: ${file}`,
    }));
  }
  return base.replace(/\.(js|css)$/, "");
}

/**
 * Calculates SHA-256 hash of file content
 *
 * @param content - File content as bytes
 * @returns First 8 characters of hex-encoded hash
 */
export async function calculateFileHash(content: Uint8Array): Promise<string> {
  // Ensure proper BufferSource type for Deno 2 compatibility
  const buffer = new Uint8Array(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").substring(0, 8);
}

/**
 * Determines which imports are critical and should be preloaded
 *
 * @param path - Import path to check
 * @returns True if import is critical
 */
export function isCriticalImport(path: string): boolean {
  return path.includes("react") || path.includes("veryfront") || path.includes("router");
}

/**
 * Gets preload hints for critical imports
 *
 * @param output - Metafile output entry
 * @param outDir - Output directory for relative path calculation
 * @returns Array of critical import paths to preload
 */
export function getPreloadHints(output: MetafileOutput, outDir: string): string[] {
  if (!output.imports) return [];

  return output.imports
    .filter((imp) => isCriticalImport(imp.path))
    .map((imp) => relative(outDir, imp.path));
}

/**
 * Extracts chunk information from metafile output
 *
 * @param file - Absolute file path
 * @param output - Metafile output entry
 * @param outDir - Output directory for relative path calculation
 * @returns Complete chunk information with metadata
 */
export async function getChunkInfo(
  file: string,
  output: MetafileOutput,
  outDir: string,
): Promise<ChunkInfo> {
  const content = await readFileBytes(file);
  const hash = await calculateFileHash(content);

  return {
    name: extractChunkName(file),
    file: relative(outDir, file),
    imports: output.imports.map((imp) => relative(outDir, imp.path)),
    css: output.cssBundle ? relative(outDir, output.cssBundle) : undefined,
    size: content.byteLength,
    hash,
  };
}

/**
 * Adds a route entry to the manifest
 *
 * @param manifest - Manifest to update
 * @param output - Metafile output entry
 * @param relativePath - Relative path to output file
 * @param routeMap - Map of entry names to route paths
 * @param outDir - Output directory for relative path calculation
 */
export function addRouteToManifest(
  manifest: ChunkManifest,
  output: MetafileOutput,
  relativePath: string,
  routeMap: Map<string, string>,
  outDir: string,
): void {
  const entryName = extractEntryName(output.entryPoint!);
  const routePath = routeMap.get(entryName) || `/${entryName}`;

  manifest.routes[routePath] = {
    entry: relativePath,
    chunks: output.imports.map((imp) => relative(outDir, imp.path)),
    css: output.cssBundle ? [relative(outDir, output.cssBundle)] : [],
    preload: getPreloadHints(output, outDir),
  };
}

/**
 * Builds complete chunk manifest from esbuild metafile
 *
 * @param metafile - ESBuild metafile with build outputs
 * @param routeMap - Map of entry names to route paths
 * @param outDir - Output directory for relative path calculation
 * @returns Complete chunk manifest
 */
export async function buildManifest(
  metafile: Metafile,
  routeMap: Map<string, string>,
  outDir: string,
): Promise<ChunkManifest> {
  const manifest: ChunkManifest = {
    version: "1.0",
    routes: {},
    chunks: {},
    shared: [],
  };

  for (const [outputFile, output] of Object.entries(metafile.outputs)) {
    if (!outputFile.endsWith(".js")) continue;

    const relativePath = relative(outDir, outputFile);
    const chunkInfo = await getChunkInfo(outputFile, output, outDir);
    manifest.chunks[relativePath] = chunkInfo;

    if (output.entryPoint) {
      addRouteToManifest(manifest, output, relativePath, routeMap, outDir);
    } else {
      manifest.shared.push(relativePath);
    }
  }

  return manifest;
}

/**
 * Writes manifest to disk as JSON
 *
 * @param manifest - Chunk manifest to write
 * @param outDir - Output directory for manifest.json
 */
export async function writeManifest(manifest: ChunkManifest, outDir: string): Promise<void> {
  await writeTextFile(
    join(outDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
}
