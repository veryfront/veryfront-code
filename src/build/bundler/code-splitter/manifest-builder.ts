
import type { Metafile } from "esbuild/mod.js";
import { join, relative } from "std/path/mod.ts";
import { createFileSystem } from "../../../platform/compat/fs.ts";
import type { ChunkInfo, ChunkManifest, MetafileOutput } from "./types.ts";
import { createError, toError } from "../../../core/errors/veryfront-error.ts";

const fs = createFileSystem();

export function extractEntryName(entryPoint: string): string {
  const filename = entryPoint.split("/").pop();
  if (!filename) {
    throw toError(createError({
      type: "config",
      message: `Invalid entry point path: ${entryPoint}`,
    }));
  }
  const nameWithoutExt = filename.replace(/\.(ts|tsx|js|jsx|mdx)$/, "");
  return nameWithoutExt || "unknown";
}

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

export async function calculateFileHash(content: Uint8Array): Promise<string> {
  const buffer = new Uint8Array(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").substring(0, 8);
}

export function isCriticalImport(path: string): boolean {
  return path.includes("react") || path.includes("veryfront") || path.includes("router");
}

export function getPreloadHints(output: MetafileOutput, outDir: string): string[] {
  if (!output.imports) return [];

  return output.imports
    .filter((imp) => isCriticalImport(imp.path))
    .map((imp) => relative(outDir, imp.path));
}

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

export async function writeManifest(manifest: ChunkManifest, outDir: string): Promise<void> {
  await fs.writeTextFile(
    join(outDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
}
