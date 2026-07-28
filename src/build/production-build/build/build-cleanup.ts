import { serverLogger as logger } from "#veryfront/utils";
import type { VeryfrontRenderer } from "#veryfront/rendering/index.ts";
import type { BuildStats } from "#veryfront/server/build-types.ts";

export async function cleanupRenderer(renderer: VeryfrontRenderer): Promise<void> {
  await renderer.destroy?.();
}

export async function cleanupCaches(): Promise<void> {
  const { destroyTransformCache } = await import(
    "#veryfront/transforms/esm/transform-cache.ts"
  );
  destroyTransformCache();
}

export async function performCleanup(renderer: VeryfrontRenderer): Promise<void> {
  const failures: unknown[] = [];

  try {
    await cleanupRenderer(renderer);
  } catch (error) {
    failures.push(error);
  }
  try {
    await cleanupCaches();
  } catch (error) {
    failures.push(error);
  }

  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, "Production build runtime cleanup failed");
  }
}

export function logBuildCompletion(stats: BuildStats): void {
  logger.info("Build complete!", {
    pages: stats.pages,
    chunks: stats.chunks,
    assets: stats.assets,
    totalSize: `${(stats.totalSize / 1024 / 1024).toFixed(2)} MB`,
    duration: `${(stats.duration / 1000).toFixed(2)}s`,
  });
}
