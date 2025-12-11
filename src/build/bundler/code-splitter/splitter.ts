
import { bundlerLogger as logger } from "@veryfront/utils";
import type { Metafile } from "esbuild/mod.js";
import { ensureDir } from "std/fs/mod.ts";
import { relative } from "std/path/mod.ts";
import type { ChunkInfo, SplitOptions, SplitResult } from "./types.ts";
import { createEntryPoints } from "./entry-points.ts";
import { createBuildContext } from "./build-context.ts";
import { buildManifest, getChunkInfo, writeManifest } from "./manifest-builder.ts";
import { createError, toError } from "../../../core/errors/veryfront-error.ts";

export class CodeSplitter {
  private options: SplitOptions;

  constructor(options: SplitOptions) {
    this.options = options;
  }

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

  private calculateTotalSize(
    entries: Map<string, ChunkInfo>,
    shared: Map<string, ChunkInfo>,
  ): number {
    const entrySize = Array.from(entries.values()).reduce((sum, chunk) => sum + chunk.size, 0);
    const sharedSize = Array.from(shared.values()).reduce((sum, chunk) => sum + chunk.size, 0);
    return entrySize + sharedSize;
  }
}
