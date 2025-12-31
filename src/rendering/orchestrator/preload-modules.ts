/**
 * Eager Module Preloading
 *
 * Preloads heavy modules at startup to reduce first-request latency.
 * These modules are commonly needed during rendering but are typically
 * lazy-imported on first use, causing cold start delays.
 */

import { rendererLogger as logger, timeAsync } from "@veryfront/utils";

let preloaded = false;

/**
 * Preload heavy modules to warm up the module cache.
 * This runs during initialization to move lazy import costs from
 * first request to startup time.
 */
export async function preloadModules(): Promise<void> {
  if (preloaded) {
    return;
  }

  logger.info("[ModulePreloader] Starting eager module preload");

  // Preload in parallel for faster startup
  await Promise.all([
    // MDX Compiler - heaviest module, used for all MDX compilation
    timeAsync("preload-mdx-compiler", async () => {
      await import("@veryfront/transforms/mdx/compiler/index.ts");
    }, "module-preload"),

    // ESM Transform - used for converting TSX/JSX to ESM
    timeAsync("preload-esm-transform", async () => {
      await import("@veryfront/transforms/esm-transform.ts");
    }, "module-preload"),

    // React version detector - used for per-project React version detection
    timeAsync("preload-react-version", async () => {
      await import("@veryfront/react");
    }, "module-preload"),

    // Node.js stream modules - used for streaming SSR
    timeAsync("preload-node-stream", async () => {
      await import("node:stream");
      await import("node:buffer");
    }, "module-preload"),

    // Platform adapter detection
    timeAsync("preload-adapter", async () => {
      await import("@veryfront/platform/adapters/detect.ts");
    }, "module-preload"),
  ]);

  preloaded = true;
  logger.info("[ModulePreloader] Module preload complete");
}

/**
 * Check if modules have been preloaded
 */
export function isPreloaded(): boolean {
  return preloaded;
}
