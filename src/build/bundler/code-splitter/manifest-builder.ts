/**
 * Chunk manifest building and metadata extraction
 * @module code-splitter/manifest-builder
 */

import type { Metafile } from "veryfront/extensions/bundler";
import { basename, isAbsolute, join, relative, resolve } from "#veryfront/compat/path/index.ts";
import { createFileSystem, realPath } from "#veryfront/platform/compat/fs.ts";
import type { ChunkInfo, ChunkManifest, MetafileOutput } from "./types.ts";
import { createError, toError } from "#veryfront/errors";
import { computeHashBytes } from "#veryfront/utils";
import { CHUNK_MANIFEST_VERSION, MAX_CHUNK_MANIFEST_ENTRIES } from "./constants.ts";
import { validateChunkManifest } from "./manifest-validator.ts";

const fs = createFileSystem();
const MAX_CHUNK_BYTES = 256 * 1024 * 1024;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isPathWithin(rootPath: string, candidatePath: string): boolean {
  const relativePath = relative(rootPath, candidatePath);
  return relativePath === "." ||
    (!isAbsolute(relativePath) &&
      relativePath !== ".." &&
      !relativePath.startsWith("../") &&
      !relativePath.startsWith("..\\"));
}

function toManifestPath(path: string, outDir: string): string {
  const absolutePath = isAbsolute(path) ? path : resolve(path);
  const relativePath = relative(resolve(outDir), absolutePath)
    .replaceAll("\\", "/")
    .replace(/^\.\//, "");

  if (
    !relativePath ||
    isAbsolute(relativePath) ||
    relativePath.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new TypeError(`Chunk output is outside the configured output directory: ${path}`);
  }

  return relativePath;
}

/** Extracts entry name from entry point path */
export function extractEntryName(entryPoint: string): string {
  if (!entryPoint || /[\\/]$/.test(entryPoint)) {
    throw toError(
      createError({
        type: "config",
        message: `Invalid entry point path: ${entryPoint}`,
      }),
    );
  }

  return basename(entryPoint).replace(/\.(ts|tsx|js|jsx|mdx)$/i, "") || "unknown";
}

/** Extracts chunk name from file path */
export function extractChunkName(file: string): string {
  if (!file || /[\\/]$/.test(file)) {
    throw toError(
      createError({
        type: "config",
        message: `Invalid chunk file path: ${file}`,
      }),
    );
  }

  return basename(file).replace(/\.(js|css)$/i, "");
}

/** Calculates SHA-256 hash of file content (returns first 8 hex chars) */
export async function calculateFileHash(content: Uint8Array): Promise<string> {
  const hashInput = content.buffer instanceof ArrayBuffer
    ? new Uint8Array(content.buffer, content.byteOffset, content.byteLength)
    : content.slice();
  return (await computeHashBytes(hashInput)).slice(0, 8);
}

/** Determines which imports are critical and should be preloaded */
export function isCriticalImport(path: string): boolean {
  return path.includes("react") || path.includes("veryfront") || path.includes("router");
}

function getBundledImportPaths(output: MetafileOutput, outDir: string): string[] {
  const paths = (output.imports ?? [])
    .filter((imported) => !imported.external)
    .map((imported) => toManifestPath(imported.path, outDir))
    .sort(compareText);

  for (let index = 1; index < paths.length; index++) {
    if (paths[index] === paths[index - 1]) {
      throw new TypeError(`Chunk metadata contains a duplicate import: ${paths[index]}`);
    }
  }
  return paths;
}

/** Gets preload hints for critical imports */
export function getPreloadHints(output: MetafileOutput, outDir: string): string[] {
  return getBundledImportPaths(output, outDir).filter(isCriticalImport);
}

async function readVerifiedChunk(
  file: string,
  output: MetafileOutput,
  outDir: string,
): Promise<Uint8Array> {
  const info = fs.lstat ? await fs.lstat(file) : await fs.stat(file);
  if (
    info.isSymlink ||
    !info.isFile ||
    info.isDirectory ||
    !Number.isSafeInteger(info.size) ||
    info.size < 0 ||
    info.size > MAX_CHUNK_BYTES
  ) {
    throw new TypeError("Chunk output is not a safe bounded regular file");
  }
  if (
    !Number.isSafeInteger(output.bytes) ||
    output.bytes < 0 ||
    output.bytes !== info.size
  ) {
    throw new TypeError("Chunk output size does not match bundler metadata");
  }

  const [physicalOutDir, physicalFile] = await Promise.all([
    realPath(outDir),
    realPath(file),
  ]);
  if (!isPathWithin(physicalOutDir, physicalFile)) {
    throw new TypeError("Chunk output resolved outside the configured output directory");
  }

  const content = await fs.readFile(file);
  if (content.byteLength !== info.size || content.byteLength > MAX_CHUNK_BYTES) {
    throw new TypeError("Chunk output changed while it was being read");
  }
  return content;
}

/** Extracts chunk information from metafile output */
export async function getChunkInfo(
  file: string,
  output: MetafileOutput,
  outDir: string,
): Promise<ChunkInfo> {
  const content = await readVerifiedChunk(file, output, outDir);
  const hash = await calculateFileHash(content);

  return {
    name: extractChunkName(file),
    file: toManifestPath(file, outDir),
    imports: getBundledImportPaths(output, outDir),
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
    chunks: getBundledImportPaths(output, outDir),
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
    version: CHUNK_MANIFEST_VERSION,
    routes: Object.create(null),
    chunks: Object.create(null),
    shared: [],
  };

  const outputs = Object.entries(metafile.outputs);
  if (outputs.length > MAX_CHUNK_MANIFEST_ENTRIES) {
    throw new TypeError(
      `Code splitter emitted more than ${MAX_CHUNK_MANIFEST_ENTRIES} outputs`,
    );
  }
  outputs.sort(([left], [right]) => compareText(left, right));

  const emittedEntries = new Set<string>();
  for (const [outputFile, output] of outputs) {
    if (!outputFile.endsWith(".js")) continue;

    const relativePath = toManifestPath(outputFile, outDir);
    if (Object.hasOwn(manifest.chunks, relativePath)) {
      throw new TypeError(`Duplicate chunk output path: ${relativePath}`);
    }
    manifest.chunks[relativePath] = await getChunkInfo(outputFile, output, outDir);

    if (output.entryPoint) {
      addRouteToManifest(manifest, output, relativePath, routeMap, outDir);
      emittedEntries.add(extractChunkName(relativePath));
      continue;
    }

    manifest.shared.push(relativePath);
  }

  for (const entryName of routeMap.keys()) {
    if (!emittedEntries.has(entryName)) {
      throw new TypeError(`No JavaScript output was emitted for code-splitter entry ${entryName}`);
    }
  }

  return validateChunkManifest(manifest);
}

/** Writes manifest to disk as JSON */
export async function writeManifest(manifest: ChunkManifest, outDir: string): Promise<void> {
  const validatedManifest = validateChunkManifest(manifest);
  await fs.writeTextFile(
    join(outDir, "manifest.json"),
    JSON.stringify(validatedManifest, null, 2),
  );
}
