import { serverLogger as logger } from "@veryfront/utils";
import type { VeryfrontRenderer } from "@veryfront/rendering/index.ts";
import type { BuildStats } from "@veryfront/server/build-types.ts";

export async function cleanupRenderer(renderer: VeryfrontRenderer): Promise<void> {
  if (typeof renderer.destroy === "function") {
    await renderer.destroy();
  }
}

export async function cleanupCaches(): Promise<void> {
  try {
    const { destroyTransformCache } = await import(
      "@veryfront/transforms/esm/transform-cache.ts"
    );
    destroyTransformCache();
  } catch {
    // Ignore if not available
  }

  try {
    const { destroyVendorCache } = await import("../../../build/vendor-cache.ts");
    destroyVendorCache();
  } catch {
    // Ignore if not available
  }
}

export async function performCleanup(renderer: VeryfrontRenderer): Promise<void> {
  await cleanupRenderer(renderer);
  await cleanupCaches();
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
