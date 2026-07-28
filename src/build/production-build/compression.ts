import { extname } from "#veryfront/compat/path/index.ts";
import { walk } from "#std/fs.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { BUILD_FAILED } from "#veryfront/errors";
import { DEFAULT_BUILD_CONCURRENCY, serverLogger } from "#veryfront/utils";

const logger = serverLogger.component("build-compression");
const COMPRESSIBLE_EXTENSIONS = new Set([
  ".css",
  ".csv",
  ".html",
  ".js",
  ".json",
  ".map",
  ".md",
  ".mjs",
  ".cjs",
  ".svg",
  ".txt",
  ".webmanifest",
  ".xml",
]);

export interface CompressionStats {
  files: number;
  sourceBytes: number;
  compressedBytes: number;
}

interface CompressionResult {
  written: boolean;
  bytes: number;
}

function shouldCompress(name: string): boolean {
  return name === "_redirects" || COMPRESSIBLE_EXTENSIONS.has(extname(name).toLowerCase());
}

async function compressFile(
  sourcePath: string,
  sourceSize: number,
  format: "gzip" | "brotli",
): Promise<CompressionResult> {
  const suffix = format === "gzip" ? ".gz" : ".br";
  const destinationPath = `${sourcePath}${suffix}`;
  const temporaryPath = `${destinationPath}.tmp-${crypto.randomUUID()}`;
  const fs = createFileSystem();

  if (await fs.exists(destinationPath)) {
    throw BUILD_FAILED.create({
      detail: `Compression output already exists: ${destinationPath}`,
    });
  }

  const nodeFs = await import("node:fs");
  const nodeFsPromises = await import("node:fs/promises");
  const { pipeline } = await import("node:stream/promises");
  const zlib = await import("node:zlib");
  const transform = format === "gzip" ? zlib.createGzip({ level: 9 }) : zlib.createBrotliCompress({
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 6,
    },
  });

  try {
    await pipeline(
      nodeFs.createReadStream(sourcePath),
      transform,
      nodeFs.createWriteStream(temporaryPath, { flags: "wx" }),
    );

    const compressedSize = (await nodeFsPromises.stat(temporaryPath)).size;
    if (compressedSize >= sourceSize) {
      await nodeFsPromises.rm(temporaryPath);
      return { written: false, bytes: 0 };
    }

    // Hard-link promotion is an atomic create-if-absent operation. Unlike
    // rename(), it cannot silently replace a sidecar created concurrently.
    await nodeFsPromises.link(temporaryPath, destinationPath);
    await nodeFsPromises.rm(temporaryPath);
    return { written: true, bytes: compressedSize };
  } catch (error) {
    await nodeFsPromises.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw BUILD_FAILED.create({
      detail: `Failed to create ${format} output for ${sourcePath}`,
      cause: error,
    });
  }
}

export async function compressBuildOutputs(
  outputDir: string,
  enabled: boolean,
  dryRun: boolean,
): Promise<CompressionStats> {
  const stats: CompressionStats = {
    files: 0,
    sourceBytes: 0,
    compressedBytes: 0,
  };
  if (!enabled || dryRun) return stats;

  const sources: Array<{ path: string; size: number }> = [];
  for await (
    const entry of walk(outputDir, {
      includeDirs: false,
      followSymlinks: false,
    })
  ) {
    if (entry.isSymlink) {
      throw BUILD_FAILED.create({
        detail: `Refusing to compress symbolic link in build output: ${entry.path}`,
      });
    }
    if (!entry.isFile || !shouldCompress(entry.name)) continue;

    const size = (await createFileSystem().stat(entry.path)).size;
    if (size > 0) sources.push({ path: entry.path, size });
  }
  sources.sort((left, right) => left.path.localeCompare(right.path));

  const fs = createFileSystem();
  for (const source of sources) {
    for (const suffix of [".gz", ".br"]) {
      if (await fs.exists(`${source.path}${suffix}`)) {
        throw BUILD_FAILED.create({
          detail: `Compression output already exists: ${source.path}${suffix}`,
        });
      }
    }
  }

  for (let index = 0; index < sources.length; index += DEFAULT_BUILD_CONCURRENCY) {
    const batch = sources.slice(index, index + DEFAULT_BUILD_CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map(async (source) => {
        const compression = await Promise.allSettled([
          compressFile(source.path, source.size, "gzip"),
          compressFile(source.path, source.size, "brotli"),
        ]);
        const failure = compression.find(
          (result): result is PromiseRejectedResult => result.status === "rejected",
        );
        if (failure) throw failure.reason;
        return {
          source,
          compressed: compression.map((result) =>
            (result as PromiseFulfilledResult<CompressionResult>).value
          ),
        };
      }),
    );
    const batchFailure = settled.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (batchFailure) throw batchFailure.reason;
    const results = settled.map((result) =>
      (result as PromiseFulfilledResult<{
        source: { path: string; size: number };
        compressed: CompressionResult[];
      }>).value
    );

    for (const { source, compressed } of results) {
      const written = compressed.filter((result) => result.written);
      if (written.length === 0) continue;
      stats.sourceBytes += source.size;
      stats.files += written.length;
      stats.compressedBytes += written.reduce((total, result) => total + result.bytes, 0);
    }
  }

  logger.info("Compressed build outputs", {
    sourceFiles: sources.length,
    sidecars: stats.files,
    compressedBytes: stats.compressedBytes,
  });
  return stats;
}
