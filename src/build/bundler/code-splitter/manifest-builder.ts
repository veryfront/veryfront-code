/**
 * Chunk manifest building and metadata extraction
 * @module code-splitter/manifest-builder
 */

import type { Metafile } from "veryfront/extensions/bundler";
import { extname, isAbsolute, join, relative, resolve } from "#veryfront/compat/path/index.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import type { ChunkInfo, ChunkManifest, MetafileOutput } from "./types.ts";
import { createError, toError } from "#veryfront/errors";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { isChunkManifest, MAX_CHUNK_MANIFEST_BYTES } from "./manifest-validation.ts";
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";

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

  const entryName = filename.replace(/\.(ts|tsx|js|jsx|mdx)$/, "");
  if (!entryName) throw new TypeError("Entry point must have a non-empty filename");
  return entryName;
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

  const chunkName = base.replace(/\.(js|css)$/, "");
  if (!chunkName) throw new TypeError("Chunk must have a non-empty filename");
  return chunkName;
}

/** Calculates a full SHA-256 hash of file content. */
export async function calculateFileHash(content: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", content.slice());
  return Array.from(new Uint8Array(hashBuffer), (b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Identifies generated JavaScript modules that can be module-preloaded. */
export function isCriticalImport(path: string): boolean {
  if (
    typeof path !== "string" || !path || hasUnsafeControlCharacters(path) ||
    path.includes("?") || path.includes("#")
  ) return false;
  return extname(path).toLowerCase() === ".js";
}

function toOutputRelativePath(path: string, outDir: string, description: string): string {
  if (typeof path !== "string" || !path || typeof outDir !== "string" || !outDir.trim()) {
    throw new TypeError(`${description} and output directory must not be blank`);
  }
  const outputRoot = resolve(outDir);
  const resolvedPath = resolve(path);
  const relativePath = relative(outputRoot, resolvedPath);
  const normalized = relativePath.replaceAll("\\", "/");
  if (
    !normalized || isAbsolute(relativePath) || normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new TypeError(`${description} must be inside the code-splitter output directory`);
  }
  return normalized;
}

/** Gets preload hints for local, statically imported bundle assets. */
export function getPreloadHints(output: MetafileOutput, outDir: string): string[] {
  const imports = output.imports ?? [];
  const hints = imports
    .filter((imp) => !imp.external && imp.kind === "import-statement" && isCriticalImport(imp.path))
    .map((imp) => toOutputRelativePath(imp.path, outDir, "Preloaded chunk"));
  return [...new Set(hints)];
}

/** Extracts chunk information from metafile output */
export async function getChunkInfo(
  file: string,
  output: MetafileOutput,
  outDir: string,
): Promise<ChunkInfo> {
  const relativeFilePath = toOutputRelativePath(file, outDir, "Chunk");
  const content = await fs.readFile(resolve(file));
  const hash = await calculateFileHash(content);

  return {
    name: extractChunkName(file),
    file: relativeFilePath,
    imports: [
      ...new Set(
        (output.imports ?? []).filter((imp) => !imp.external).map((imp) =>
          toOutputRelativePath(imp.path, outDir, "Imported chunk")
        ),
      ),
    ],
    css: output.cssBundle
      ? toOutputRelativePath(output.cssBundle, outDir, "Chunk CSS bundle")
      : undefined,
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
    throw new TypeError("Code-splitter entry output is not mapped to a requested route");
  }

  if (Object.hasOwn(manifest.routes, routePath)) {
    throw new TypeError(`Duplicate chunk manifest route: ${routePath}`);
  }

  manifest.routes[routePath] = {
    entry: relativePath,
    chunks: [
      ...new Set(
        (output.imports ?? []).filter((imp) => !imp.external).map((imp) =>
          toOutputRelativePath(imp.path, outDir, "Route chunk")
        ),
      ),
    ],
    css: output.cssBundle
      ? [toOutputRelativePath(output.cssBundle, outDir, "Route CSS bundle")]
      : [],
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
    const [outputFile, output] of Object.entries(metafile.outputs).sort(([a], [b]) =>
      a.localeCompare(b)
    )
  ) {
    if (!outputFile.endsWith(".js")) continue;

    const relativePath = toOutputRelativePath(outputFile, outDir, "Metafile output");
    manifest.chunks[relativePath] = await getChunkInfo(outputFile, output, outDir);

    if (output.entryPoint) {
      addRouteToManifest(manifest, output, relativePath, routeMap, outDir);
      continue;
    }

    manifest.shared.push(relativePath);
  }

  if (Object.keys(manifest.routes).length !== routeMap.size) {
    throw new TypeError("Code-splitter did not generate an entry output for every requested route");
  }

  return manifest;
}

/** Writes manifest to disk as JSON */
export async function writeManifest(manifest: ChunkManifest, outDir: string): Promise<void> {
  if (typeof outDir !== "string" || outDir.trim() === "") {
    throw new TypeError("Chunk manifest outDir must not be blank");
  }
  if (!isChunkManifest(manifest)) throw new TypeError("Invalid chunk manifest structure");

  const manifestPath = join(outDir, "manifest.json");
  const temporaryPath = `${manifestPath}.${crypto.randomUUID()}.tmp`;
  const serialized = JSON.stringify(manifest, null, 2);
  if (new TextEncoder().encode(serialized).byteLength > MAX_CHUNK_MANIFEST_BYTES) {
    throw new TypeError("Chunk manifest exceeds the size limit");
  }
  const rename = fs.rename?.bind(fs);
  if (!rename) throw new TypeError("Atomic chunk manifest writes are not supported");
  await fs.mkdir(outDir, { recursive: true });

  try {
    await fs.writeTextFile(temporaryPath, serialized);
    await rename(temporaryPath, manifestPath);
  } catch (error) {
    try {
      await fs.remove(temporaryPath);
    } catch (cleanupError) {
      if (!isNotFoundError(cleanupError)) {
        throw new AggregateError(
          [error, cleanupError],
          "Chunk manifest write and temporary-file cleanup both failed",
        );
      }
    }
    throw error;
  }
}
