export type { PageDataResponse, RendererOptions, RenderResult } from "./orchestrator/types.ts";
export { VeryfrontRenderer } from "./orchestrator/ssr.ts";

// Chunk analysis
export { analyzeProjectChunks, generateChunkManifest } from "./chunk-optimizer.ts";

// Cache stores
export { CacheCoordinator, type CacheCoordinatorOptions } from "./cache/cache-coordinator.ts";
export type { CachePayload, CacheStore } from "./cache/types.ts";
export {
  APICacheStore,
  FilesystemCacheStore,
  KVCacheStore,
  MemoryCacheStore,
  RedisCacheStore,
} from "./cache/stores/index.ts";

// Layout utilities
export {
  applyLayoutsESM,
  applyLayoutsFunctionBody,
  clearLayoutDiscoveryCache,
  compileMDXLayouts,
  computeDepsHash,
  discoverNestedLayouts,
} from "./layouts/index.ts";

// Snippet rendering
export {
  getCompiledSnippet,
  renderSnippet,
  type SnippetRenderOptions,
  type SnippetRenderResult,
} from "./snippet-renderer.ts";

import { type RendererOptions, VeryfrontRenderer } from "./orchestrator/ssr.ts";

export async function createRenderer(options: RendererOptions): Promise<VeryfrontRenderer> {
  const renderer = new VeryfrontRenderer(options);
  await renderer.initialize();
  return renderer;
}
