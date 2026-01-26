import { serverLogger as logger } from "../../../utils/index.js";
export async function cleanupRenderer(renderer) {
    await renderer.destroy?.();
}
export async function cleanupCaches() {
    try {
        const { destroyTransformCache } = await import("../../../transforms/esm/transform-cache.js");
        destroyTransformCache();
    }
    catch {
        // Ignore if not available
    }
    try {
        const { destroyVendorCache } = await import("../../vendor-cache.js");
        destroyVendorCache();
    }
    catch {
        // Ignore if not available
    }
}
export async function performCleanup(renderer) {
    await cleanupRenderer(renderer);
    await cleanupCaches();
}
export function logBuildCompletion(stats) {
    logger.info("Build complete!", {
        pages: stats.pages,
        chunks: stats.chunks,
        assets: stats.assets,
        totalSize: `${(stats.totalSize / 1024 / 1024).toFixed(2)} MB`,
        duration: `${(stats.duration / 1000).toFixed(2)}s`,
    });
}
