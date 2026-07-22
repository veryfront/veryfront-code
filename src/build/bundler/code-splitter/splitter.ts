import { bundlerLogger as logger } from "#veryfront/utils";
import type { BuildContext, BundleResult, Metafile } from "veryfront/extensions/bundler";
import { ensureDir } from "#std/fs.ts";
import { relative } from "#veryfront/compat/path/index.ts";
import type { ChunkInfo, SplitOptions, SplitResult } from "./types.ts";
import { createEntryPoints } from "./entry-points.ts";
import { createBuildContext } from "./build-context.ts";
import { buildManifest, getChunkInfo, writeManifest } from "./manifest-builder.ts";
import { createError, toError } from "#veryfront/errors";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { ensureDefaultParserContracts } from "#veryfront/extensions/parser/defaults.ts";

/** @internal */
export async function rebuildAndDispose(buildContext: BuildContext): Promise<BundleResult> {
  let result: BundleResult;
  try {
    result = await buildContext.rebuild();
  } catch (rebuildError) {
    try {
      await buildContext.dispose();
    } catch (disposeError) {
      logger.warn("Failed to dispose code-splitter context after rebuild error", {
        error: String(disposeError),
      } as unknown);
    }
    throw rebuildError;
  }

  await buildContext.dispose();
  return result;
}

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
        await ensureDefaultParserContracts();

        const { entryPoints, routeMap } = createEntryPoints(this.options.routes);
        const buildContext = await createBuildContext(this.options, entryPoints);
        const result = await rebuildAndDispose(buildContext);

        const metafile = result.metafile;
        if (!metafile?.outputs) {
          throw toError(
            createError({
              type: "build",
              message: "Build failed to generate metafile outputs",
            }),
          );
        }

        const manifest = await buildManifest(metafile, routeMap, this.options.outDir);
        await writeManifest(manifest, this.options.outDir);

        const { entries, shared } = await this.processOutputs(metafile.outputs);

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

  private async processOutputs(
    outputs: Metafile["outputs"],
  ): Promise<{ entries: Map<string, ChunkInfo>; shared: Map<string, ChunkInfo> }> {
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
    return this.sumChunkSizes(entries) + this.sumChunkSizes(shared);
  }

  private sumChunkSizes(chunks: Map<string, ChunkInfo>): number {
    let total = 0;
    for (const { size } of chunks.values()) total += size;
    return total;
  }
}
