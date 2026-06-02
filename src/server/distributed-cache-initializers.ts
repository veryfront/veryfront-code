import type { DistributedCacheInitializers } from "#veryfront/cache/distributed-cache-init.ts";
import { initializeFileCacheBackend } from "#veryfront/platform/adapters/fs/cache/file-cache.ts";
import { initializeSSRDistributedCache } from "#veryfront/modules/react-loader/ssr-module-loader/index.ts";
import { initializeTransformCache } from "#veryfront/transforms/esm/transform-cache.ts";
import { initializeHttpModuleDistributedCache } from "#veryfront/transforms/esm/http-cache-wrapper.ts";
import { initializeProjectCSSCache } from "#veryfront/html/styles-builder/tailwind-compiler.ts";

/**
 * Default wiring of distributed-cache initializers, assembled at the server
 * composition root.
 *
 * The concrete initializers live in the `transforms`, `modules`, `html`, and
 * `platform` layers. Keeping this wiring in `src/server` (which is free to
 * depend on every layer) lets `src/cache/distributed-cache-init.ts` remain a
 * low-level orchestrator that takes its initializers as an injected dependency
 * instead of reaching up into those layers itself.
 */
export const defaultDistributedCacheInitializers: DistributedCacheInitializers = {
  transformCache: initializeTransformCache,
  ssrModuleCache: initializeSSRDistributedCache,
  fileCache: initializeFileCacheBackend,
  projectCSSCache: initializeProjectCSSCache,
  httpModuleCache: initializeHttpModuleDistributedCache,
};
