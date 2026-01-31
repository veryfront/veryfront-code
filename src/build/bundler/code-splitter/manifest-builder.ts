/**
 * Chunk manifest building and metadata extraction
 * @module code-splitter/manifest-builder
 */

import type { Metafile } from "esbuild";
import { join, relative } from "#veryfront/platform/compat/path/index.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import type { ChunkInfo, ChunkManifest, MetafileOutput } from "./types.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";

const fs = createFileSystem();

/** Extracts entry name from entry point path */
export function extractEntryName(entryPoint: string): string {
  const filename = entryPoint.split("/").pop();
  if (!filename) {
    throw toError(
      createError({
        type: "config",
        message: `Invalid entry point path: ${entryPoint}`,
      }),
    );
  }

  return filename.replace(/\.(ts|tsx|js|jsx|mdx)$/, "") || "unknown";
}

/** Extracts chunk name from file path */
export function extractChunkName(file: string): string {
  const base = file.split("/").pop();
  if (!base) {
    throw toError(
      createError({
        type: "config",
        message: `Invalid chunk file path: ${file}`,
      }),
    );
  }

  return base.replace(/\.(js|css)$/, "");
}

/** Calculates SHA-256 hash of file content (returns first 8 hex chars) */
export async function calculateFileHash(content: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", content.slice());
  return Array.from(new Uint8Array(hashBuffer), (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 8);
}

/** Determines which imports are critical and should be preloaded */
export function isCriticalImport(path: string): boolean {
  return path.includes("react") || path.includes("veryfront") || path.includes("router");
}

/** Gets preload hints for critical imports */
export function getPreloadHints(output: MetafileOutput, outDir: string): string[] {
  const imports = output.imports ?? [];
  return imports.filter((imp) => isCriticalImport(imp.path)).map((imp) =>
    relative(outDir, imp.path)
  );
}

/** Extracts chunk information from metafile output */
export async function getChunkInfo(
  file: string,
  output: MetafileOutput,
  outDir: string,
): Promise<ChunkInfo> {
  const content = await fs.readFile(file);
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

/** Adds a route entry to the manifest */
export function addRouteToManifest(
  manifest: ChunkManifest,
  output: MetafileOutput,
  relativePath: string,
  routeMap: Map<string, string>,
  outDir: string,
): void {
  if (!output.entryPoint) return;

  const entryName = extractEntryName(output.entryPoint);
  const routePath = routeMap.get(entryName) ?? `/${entryName}`;

  manifest.routes[routePath] = {
    entry: relativePath,
    chunks: output.imports.map((imp) => relative(outDir, imp.path)),
    css: output.cssBundle ? [relative(outDir, output.cssBundle)] : [],
    preload: getPreloadHints(output, outDir),
  };
}

/** Builds complete chunk manifest from esbuild metafile */
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
    manifest.chunks[relativePath] = await getChunkInfo(outputFile, output, outDir);

    if (output.entryPoint) {
      addRouteToManifest(manifest, output, relativePath, routeMap, outDir);
      continue;
    }

    manifest.shared.push(relativePath);
  }

  return manifest;
}

/** Writes manifest to disk as JSON */
export async function writeManifest(manifest: ChunkManifest, outDir: string): Promise<void> {
  await fs.writeTextFile(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
}
