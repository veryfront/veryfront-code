export type { PageDataResponse, RendererOptions, RenderResult } from "./orchestrator/types.ts";
export { VeryfrontRenderer } from "./orchestrator/ssr.ts";
export * from "./client/index.ts";
export * from "./layouts/index.ts";
export {
  getCompiledSnippet,
  renderSnippet,
  type SnippetRenderOptions,
  type SnippetRenderResult,
} from "./snippet-renderer.ts";

// Render mode router exports (JIT vs legacy renderer selection)
export {
  clearCacheForProjectWithRouter,
  type CommonRenderer,
  destroyRenderers,
  getCurrentWatchBundle,
  getEffectiveRenderMode,
  getHmrRuntimeForProject,
  getRendererForMode,
  initializeRenderers,
  // Watch mode helpers
  isPreviewBundlerInitialized,
  type RenderModeRouterOptions,
  renderPageWithRouter,
  shouldUseJitRenderer,
  shouldUseWatchMode,
  startWatching,
  stopWatching,
  triggerWatchRebuild,
} from "./render-mode-router.ts";

// JIT renderer exports
export {
  destroyJitRenderer,
  getJitRenderer,
  isJitRendererInitialized,
  JitRenderer,
  type JitRendererOptions,
} from "./jit-renderer.ts";

// Preview bundler exports (for direct access when needed)
export {
  getPreviewBundler,
  type HmrMessage,
  PreviewBundler,
  type PreviewBundlerConfig,
  type ProjectContext,
  resetPreviewBundler,
} from "../bundler/preview-bundler.ts";

import { type RendererOptions, VeryfrontRenderer } from "./orchestrator/ssr.ts";

export async function createRenderer(options: RendererOptions): Promise<VeryfrontRenderer> {
  const renderer = new VeryfrontRenderer(options);
  await renderer.initialize();
  return renderer;
}
