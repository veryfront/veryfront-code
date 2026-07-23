import { bundlerLogger as logger } from "#veryfront/utils";
import type { BuildContext, BundleResult, Metafile } from "veryfront/extensions/bundler";
import { ensureDir } from "#std/fs.ts";
import { isAbsolute, relative, resolve } from "#veryfront/compat/path/index.ts";
import type { ChunkInfo, SplitOptions, SplitResult } from "./types.ts";
import { assertValidRoutePath, createEntryPoints } from "./entry-points.ts";
import { createBuildContext } from "./build-context.ts";
import { buildManifest, getChunkInfo, writeManifest } from "./manifest-builder.ts";
import { createError, toError } from "#veryfront/errors";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";

function isContainedRelativePath(path: string): boolean {
  return !isAbsolute(path) && path.split(/[\\/]/)[0] !== "..";
}

/** @internal */
export async function rebuildAndDispose(buildContext: BuildContext): Promise<BundleResult> {
  let result: BundleResult;
  try {
    result = await buildContext.rebuild();
  } catch (rebuildError) {
    try {
      await buildContext.dispose();
    } catch (disposeError) {
      throw new AggregateError(
        [rebuildError, disposeError],
        "Code splitting and context cleanup both failed",
      );
    }
    throw rebuildError;
  }

  await buildContext.dispose();
  return result;
}

export class CodeSplitter {
  private readonly options: SplitOptions;

  constructor(options: SplitOptions) {
    this.options = normalizeSplitOptions(options);
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

    const sortedOutputs = Object.entries(outputs).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0
    );
    for (const [file, info] of sortedOutputs) {
      if (!file.endsWith(".js")) continue;
      const relativePath = relative(this.options.outDir, file).replaceAll("\\", "/");
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

function normalizeSplitOptions(options: SplitOptions): SplitOptions {
  if (!options || typeof options !== "object") {
    throw new TypeError("Code splitter options must be an object");
  }
  if (typeof options.projectDir !== "string" || options.projectDir.trim() === "") {
    throw new TypeError("Code splitter projectDir must not be blank");
  }
  if (typeof options.outDir !== "string" || options.outDir.trim() === "") {
    throw new TypeError("Code splitter outDir must not be blank");
  }
  if (options.mode !== "development" && options.mode !== "production") {
    throw new TypeError(`Invalid code splitter mode: ${String(options.mode)}`);
  }
  if (!Array.isArray(options.routes)) {
    throw new TypeError("Code splitter routes must be an array");
  }

  const projectDir = resolve(options.projectDir);
  const outDir = resolve(options.outDir);
  const projectFromOutput = relative(outDir, projectDir);
  if (
    projectFromOutput === "" ||
    isContainedRelativePath(projectFromOutput)
  ) {
    throw new TypeError("Code splitter outDir must not contain projectDir");
  }
  if (
    options.moduleResolution !== undefined && options.moduleResolution !== "cdn" &&
    options.moduleResolution !== "self-hosted" && options.moduleResolution !== "bundled"
  ) {
    throw new TypeError("Invalid code splitter moduleResolution");
  }
  const routes = options.routes.map((route) => {
    if (!route || typeof route !== "object") {
      throw new TypeError("Code-splitter routes must contain route objects");
    }
    assertValidRoutePath(route.path);
    if (typeof route.file !== "string" || route.file.trim() === "") {
      throw new TypeError(`Invalid code-splitter route file for ${route.path}`);
    }

    const file = resolve(projectDir, route.file);
    const projectRelativePath = relative(projectDir, file);
    if (
      projectRelativePath === "" ||
      !isContainedRelativePath(projectRelativePath)
    ) {
      throw new TypeError(`Code-splitter route file is outside projectDir: ${route.file}`);
    }

    return { ...route, file };
  });

  const normalizeSpecifiers = (value: string[] | undefined, name: string): string[] | undefined => {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) throw new TypeError(`Code splitter ${name} must be an array`);
    const normalized = value.map((specifier) => {
      if (
        typeof specifier !== "string" || !specifier || specifier.trim() !== specifier ||
        hasUnsafeControlCharacters(specifier)
      ) {
        throw new TypeError(`Code splitter ${name} must contain non-empty specifiers`);
      }
      return specifier;
    });
    if (new Set(normalized).size !== normalized.length) {
      throw new TypeError(`Code splitter ${name} must not contain duplicates`);
    }
    return normalized;
  };

  return {
    ...options,
    projectDir,
    outDir,
    routes,
    external: normalizeSpecifiers(options.external, "external"),
  };
}
