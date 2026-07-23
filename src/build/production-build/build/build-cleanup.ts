import { serverLogger as logger } from "#veryfront/utils";
import type { VeryfrontRenderer } from "#veryfront/rendering/index.ts";
import type { BuildStats } from "#veryfront/server/build-types.ts";
import { destroyTransformCache } from "#veryfront/transforms/esm/transform-cache.ts";
import { ensureError } from "#veryfront/errors";

/** Destroy renderer-owned resources when the renderer exposes cleanup. */
export async function cleanupRenderer(renderer: VeryfrontRenderer): Promise<void> {
  await renderer.destroy?.();
}

/** Destroy process-local transform cache state. */
export function cleanupCaches(): void {
  destroyTransformCache();
}

/** Run renderer and cache cleanup while preserving every independent failure. */
export async function performCleanup(renderer: VeryfrontRenderer): Promise<void> {
  const errors: Error[] = [];
  try {
    await cleanupRenderer(renderer);
  } catch (error) {
    errors.push(ensureError(error));
  }
  try {
    cleanupCaches();
  } catch (error) {
    errors.push(ensureError(error));
  }

  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "Build resource cleanup failed");
}

/** Write a structured production build completion summary. */
export function logBuildCompletion(stats: BuildStats): void {
  logger.info("Build complete!", {
    pages: stats.pages,
    chunks: stats.chunks,
    assets: stats.assets,
    totalSize: `${(stats.totalSize / 1024 / 1024).toFixed(2)} MB`,
    duration: `${(stats.duration / 1000).toFixed(2)}s`,
  });
}
