/**
 * Main code splitter orchestrator
 * @module code-splitter/splitter
 */

import { bundlerLogger as logger } from "@veryfront/utils";
import type { Metafile } from "esbuild";
import { ensureDir } from "@std/fs";
import { relative } from "@veryfront/platform/compat/path/index.ts";
import type { ChunkInfo, SplitOptions, SplitResult } from "./types.ts";
import { createEntryPoints } from "./entry-points.ts";
import { createBuildContext } from "./build-context.ts";
import { buildManifest, getChunkInfo, writeManifest } from "./manifest-builder.ts";
import { createError, toError } from "@veryfront/errors/veryfront-error.ts";

/**
 * Main code splitter class for bundling and splitting application code
 *
 * Orchestrates the entire code splitting process:
 * 1. Creates entry points from routes
 * 2. Configures and runs ESBuild with splitting enabled
 * 3. Generates chunk manifest with metadata
 * 4. Processes outputs into entries and shared chunks
 *
 * @example
 * ```ts
 * const splitter = new CodeSplitter({
 *   projectDir: '/path/to/project',
 *   outDir: '/path/to/output',
 *   mode: 'production',
 *   routes: [
 *     { path: '/', file: './pages/index.tsx' },
 *     { path: '/about', file: './pages/about.tsx' }
 *   ]
 * })
 *
 * const result = await splitter.split()
 * console.log(result.entries.size) // 2 entry chunks
 * ```
 */
export class CodeSplitter {
  private options: SplitOptions;

  constructor(options: SplitOptions) {
    this.options = options;
  }

  /**
   * Executes the complete code splitting process
   *
   * @returns Split result with entries, shared chunks, and manifest
   */
  async split(): Promise<SplitResult> {
    logger.info("Starting code splitting", {
      routes: this.options.routes.length,
      mode: this.options.mode,
    });

    await ensureDir(this.options.outDir);

    const { entryPoints, routeMap } = createEntryPoints(this.options.routes);
    const buildContext = await createBuildContext(this.options, entryPoints);

    const result = await buildContext.rebuild();
    await buildContext.dispose();

    const manifest = await buildManifest(result.metafile!, routeMap, this.options.outDir);
    await writeManifest(manifest, this.options.outDir);

    if (!result.metafile?.outputs) {
      throw toError(createError({
        type: "build",
        message: "Build failed to generate metafile outputs",
      }));
    }
    const { entries, shared } = await this.processOutputs(result.metafile.outputs);

    logger.info("Code splitting complete", {
      entries: entries.size,
      shared: shared.size,
      totalSize: this.calculateTotalSize(entries, shared),
    });

    return { entries, shared, manifest };
  }

  /**
   * Processes build outputs into entry and shared chunks
   *
   * @param outputs - ESBuild metafile outputs
   * @returns Maps of entry chunks and shared chunks
   */
  private async processOutputs(outputs: Metafile["outputs"]): Promise<{
    entries: Map<string, ChunkInfo>;
    shared: Map<string, ChunkInfo>;
  }> {
    const entries = new Map<string, ChunkInfo>();
    const shared = new Map<string, ChunkInfo>();

    for (const [file, info] of Object.entries(outputs)) {
      const relativePath = relative(this.options.outDir, file);
      const chunkInfo = await getChunkInfo(file, info, this.options.outDir);

      if (info.entryPoint) {
        entries.set(relativePath, chunkInfo);
      } else {
        shared.set(relativePath, chunkInfo);
      }
    }

    return { entries, shared };
  }

  /**
   * Calculates total size of all chunks
   *
   * @param entries - Entry chunk map
   * @param shared - Shared chunk map
   * @returns Total size in bytes
   */
  private calculateTotalSize(
    entries: Map<string, ChunkInfo>,
    shared: Map<string, ChunkInfo>,
  ): number {
    const sumChunkSizes = (chunks: Map<string, ChunkInfo>): number =>
      Array.from(chunks.values()).reduce((sum, chunk) => sum + chunk.size, 0);

    return sumChunkSizes(entries) + sumChunkSizes(shared);
  }
}
