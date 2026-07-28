/**
 * Chunk manifest building and metadata extraction
 * @module code-splitter/manifest-builder
 */

import type { Metafile } from "veryfront/extensions/bundler";
import { isAbsolute, join, relative, resolve } from "#veryfront/compat/path/index.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import type { ChunkInfo, ChunkManifest, MetafileOutput } from "./types.ts";
import { createError, toError } from "#veryfront/errors";
import { computeHashBytes } from "#veryfront/utils";

const fs = createFileSystem();

function toManifestPath(path: string, outDir: string): string {
  const absolutePath = isAbsolute(path) ? path : resolve(path);
  const relativePath = relative(resolve(outDir), absolutePath)
    .replaceAll("\\", "/")
    .replace(/^\.\//, "");

  if (
    !relativePath ||
    relativePath.startsWith("/") ||
    relativePath.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new TypeError(`Chunk output is outside the configured output directory: ${path}`);
  }

  return relativePath;
}

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
  return (await computeHashBytes(content.slice())).slice(0, 8);
}

/** Determines which imports are critical and should be preloaded */
export function isCriticalImport(path: string): boolean {
  return path.includes("react") || path.includes("veryfront") || path.includes("router");
}

/** Gets preload hints for critical imports */
export function getPreloadHints(output: MetafileOutput, outDir: string): string[] {
  const imports = output.imports ?? [];
  return imports.filter((imp) => isCriticalImport(imp.path)).map((imp) =>
    toManifestPath(imp.path, outDir)
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
    file: toManifestPath(file, outDir),
    imports: output.imports.map((imp) => toManifestPath(imp.path, outDir)),
    css: output.cssBundle ? toManifestPath(output.cssBundle, outDir) : undefined,
    size: content.byteLength,
    hash,
  };
}

/** Adds a route entry to the manifest */
function addRouteToManifest(
  manifest: ChunkManifest,
  output: MetafileOutput,
  relativePath: string,
  routeMap: Map<string, string>,
  outDir: string,
): void {
  if (!output.entryPoint) return;

  const entryName = extractChunkName(relativePath);
  const routePath = routeMap.get(entryName);
  if (routePath === undefined) {
    throw new TypeError(`No route mapping exists for code-splitter entry ${entryName}`);
  }
  if (Object.hasOwn(manifest.routes, routePath)) {
    throw new TypeError(`Duplicate route in chunk manifest: ${routePath}`);
  }

  manifest.routes[routePath] = {
    entry: relativePath,
    chunks: output.imports.map((imp) => toManifestPath(imp.path, outDir)),
    css: output.cssBundle ? [toManifestPath(output.cssBundle, outDir)] : [],
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

  for (
    const [outputFile, output] of Object.entries(metafile.outputs).sort(([left], [right]) =>
      left.localeCompare(right)
    )
  ) {
    if (!outputFile.endsWith(".js")) continue;

    const relativePath = toManifestPath(outputFile, outDir);
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
