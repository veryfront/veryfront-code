import { bundlerLogger as logger } from "#veryfront/utils";
import type { BuildContext, BundleResult } from "veryfront/extensions/bundler";
import { ensureDir } from "#std/fs.ts";
import type { ChunkInfo, SplitOptions, SplitResult } from "./types.ts";
import { createEntryPoints } from "./entry-points.ts";
import { createBuildContext } from "./build-context.ts";
import { buildManifest, writeManifest } from "./manifest-builder.ts";
import { BUILD_FAILED, createError, toError } from "#veryfront/errors";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { ensureDefaultParserContracts } from "#veryfront/extensions/parser/defaults.ts";
import { combinePrimaryAndCleanupFailures } from "./lifecycle-errors.ts";

/** @internal */
export async function rebuildAndDispose(buildContext: BuildContext): Promise<BundleResult> {
  let result: BundleResult;
  try {
    result = await buildContext.rebuild();
  } catch (rebuildError) {
    try {
      await buildContext.dispose();
    } catch (disposeError) {
      throw combinePrimaryAndCleanupFailures(
        rebuildError,
        disposeError,
        "Code-splitter rebuild failed and context disposal also failed",
      );
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

        if (result.errors.length > 0) {
          throw BUILD_FAILED.create({
            detail: `Code splitting reported ${result.errors.length} bundler error(s)`,
          });
        }
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

        const { entries, shared } = this.processManifest(manifest);

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

  private processManifest(
    manifest: SplitResult["manifest"],
  ): { entries: Map<string, ChunkInfo>; shared: Map<string, ChunkInfo> } {
    const entries = new Map<string, ChunkInfo>();
    const shared = new Map<string, ChunkInfo>();

    for (const route of Object.values(manifest.routes)) {
      const chunk = manifest.chunks[route.entry];
      if (!chunk) {
        throw new TypeError(`Chunk manifest is missing route entry ${route.entry}`);
      }
      entries.set(route.entry, chunk);
    }
    for (const path of manifest.shared) {
      const chunk = manifest.chunks[path];
      if (!chunk) {
        throw new TypeError(`Chunk manifest is missing shared chunk ${path}`);
      }
      shared.set(path, chunk);
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
