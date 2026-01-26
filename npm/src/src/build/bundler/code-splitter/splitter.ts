import { bundlerLogger as logger } from "../../../utils/index.js";
import type { Metafile } from "esbuild";
import { ensureDir } from "../../../../deps/deno.land/std@0.220.0/fs/mod.js";
import { relative } from "../../../platform/compat/path/index.js";
import type { ChunkInfo, SplitOptions, SplitResult } from "./types.js";
import { createEntryPoints } from "./entry-points.js";
import { createBuildContext } from "./build-context.js";
import { buildManifest, getChunkInfo, writeManifest } from "./manifest-builder.js";
import { createError, toError } from "../../../errors/veryfront-error.js";
import { withSpan } from "../../../observability/tracing/otlp-setup.js";

export class CodeSplitter {
  private options: SplitOptions;

  constructor(options: SplitOptions) {
    this.options = options;
  }

  split(): Promise<SplitResult> {
    return withSpan(
      "build.codeSplitter.split",
      async () => {
        logger.info("Starting code splitting", {
          routes: this.options.routes.length,
          mode: this.options.mode,
        });

        await ensureDir(this.options.outDir);

        const { entryPoints, routeMap } = createEntryPoints(this.options.routes);
        const buildContext = await createBuildContext(this.options, entryPoints);

        const result = await buildContext.rebuild();
        await buildContext.dispose();

        if (!result.metafile?.outputs) {
          throw toError(
            createError({
              type: "build",
              message: "Build failed to generate metafile outputs",
            }),
          );
        }

        const manifest = await buildManifest(result.metafile, routeMap, this.options.outDir);
        await writeManifest(manifest, this.options.outDir);

        const { entries, shared } = await this.processOutputs(result.metafile.outputs);

        logger.info("Code splitting complete", {
          entries: entries.size,
          shared: shared.size,
          totalSize: this.calculateTotalSize(entries, shared),
        });

        return { entries, shared, manifest };
      },
      {
        "build.splitter.routeCount": this.options.routes.length,
        "build.splitter.mode": this.options.mode,
      },
    );
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
        continue;
      }

      shared.set(relativePath, chunkInfo);
    }

    return { entries, shared };
  }

  private calculateTotalSize(
    entries: Map<string, ChunkInfo>,
    shared: Map<string, ChunkInfo>,
  ): number {
    return this.sumChunkSizes(entries) + this.sumChunkSizes(shared);
  }

  private sumChunkSizes(chunks: Map<string, ChunkInfo>): number {
    let total = 0;
    for (const chunk of chunks.values()) total += chunk.size;
    return total;
  }
}
