export type { PageDataResponse, RendererOptions, RenderResult } from "./orchestrator/types.ts";
export { VeryfrontRenderer } from "./orchestrator/ssr.ts";
export * from "./client/index.ts";
export * from "./layouts/index.ts";

import { type RendererOptions, VeryfrontRenderer } from "./orchestrator/ssr.ts";

export async function createRenderer(options: RendererOptions): Promise<VeryfrontRenderer> {
  const renderer = new VeryfrontRenderer(options);
  await renderer.initialize();
  return renderer;
}
