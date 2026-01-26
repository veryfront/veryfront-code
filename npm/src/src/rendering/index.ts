export type { PageDataResponse, RendererOptions, RenderResult } from "./orchestrator/types.js";
export { VeryfrontRenderer } from "./orchestrator/ssr.js";
export * from "./client/index.js";
export * from "./layouts/index.js";
export {
  getCompiledSnippet,
  renderSnippet,
  type SnippetRenderOptions,
  type SnippetRenderResult,
} from "./snippet-renderer.js";

import { type RendererOptions, VeryfrontRenderer } from "./orchestrator/ssr.js";

export async function createRenderer(options: RendererOptions): Promise<VeryfrontRenderer> {
  const renderer = new VeryfrontRenderer(options);
  await renderer.initialize();
  return renderer;
}
