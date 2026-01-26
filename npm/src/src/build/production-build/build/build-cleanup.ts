import { serverLogger as logger } from "../../../utils/index.js";
import type { VeryfrontRenderer } from "../../../rendering/index.js";
import type { BuildStats } from "../../../server/build-types.js";

export async function cleanupRenderer(renderer: VeryfrontRenderer): Promise<void> {
  await renderer.destroy?.();
}

export async function cleanupCaches(): Promise<void> {
  try {
    const { destroyTransformCache } = await import("../../../transforms/esm/transform-cache.js");
    destroyTransformCache();
  } catch {
    // Ignore if not available
  }

  try {
    const { destroyVendorCache } = await import("../../vendor-cache.js");
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
