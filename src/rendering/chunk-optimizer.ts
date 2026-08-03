import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { DEFAULT_MAX_FILE_SIZE_BYTES } from "#veryfront/utils/constants/buffers.ts";
import type {
  ChunkAnalysis,
  ChunkOptimizerFileSystem,
  PageImports,
} from "./chunk-optimizer/contracts.ts";
import { discoverPageFiles } from "./chunk-optimizer/file-discovery.ts";
import { snapshotChunkOptimizerFileSystem } from "./chunk-optimizer/filesystem.ts";
import { MAX_TOTAL_SOURCE_BYTES } from "./chunk-optimizer/limits.ts";
import { analyzePageImports, utf8ByteLength } from "./chunk-optimizer/source-imports.ts";
import { generateChunkSuggestions } from "./chunk-optimizer/suggestions.ts";

export type {
  ChunkAnalysis,
  ChunkManifest,
  ChunkOptimizerFileSystem,
  ChunkSuggestion,
  PageImports,
} from "./chunk-optimizer/contracts.ts";
export { generateChunkManifest } from "./chunk-optimizer/manifest.ts";

/**
 * Analyze authored Markdown and MDX pages and recommend reusable vendor chunks.
 *
 * Results are deterministic for a stable filesystem snapshot. Operational
 * errors reject instead of returning a partial dependency graph.
 */
export async function analyzeProjectChunks(
  projectDir: string,
  fs?: ChunkOptimizerFileSystem,
): Promise<ChunkAnalysis> {
  const fileSystem = snapshotChunkOptimizerFileSystem(
    fs ?? createFileSystem(),
  );
  const discoveredPaths = await discoverPageFiles(projectDir, fileSystem);
  const pages = new Map<string, PageImports>();
  const sharedDeps = new Map<string, number>();
  let totalSourceBytes = 0;

  for (const path of discoveredPaths) {
    const content = await fileSystem.readTextFile(path);
    if (typeof content !== "string") {
      throw new TypeError(
        `Chunk analysis filesystem returned non-text content for ${path}`,
      );
    }
    const sourceBytes = utf8ByteLength(content);
    if (sourceBytes > DEFAULT_MAX_FILE_SIZE_BYTES) {
      throw new RangeError(
        `Chunk analysis source ${path} exceeds ${DEFAULT_MAX_FILE_SIZE_BYTES} bytes`,
      );
    }
    if (sourceBytes > MAX_TOTAL_SOURCE_BYTES - totalSourceBytes) {
      throw new RangeError(
        `Chunk analysis total source limit of ${MAX_TOTAL_SOURCE_BYTES} bytes was exceeded`,
      );
    }
    totalSourceBytes += sourceBytes;

    const imports = analyzePageImports(content);
    const pageImports: PageImports = {
      path,
      local: imports.local,
      remote: imports.remote,
      shared: imports.shared,
    };
    pages.set(path, pageImports);
    for (
      const dependency of new Set([
        ...pageImports.remote,
        ...pageImports.shared,
      ])
    ) {
      sharedDeps.set(dependency, (sharedDeps.get(dependency) ?? 0) + 1);
    }
  }

  return {
    pages,
    sharedDeps,
    suggestedChunks: generateChunkSuggestions(pages, sharedDeps),
  };
}
