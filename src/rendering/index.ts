export type { RendererOptions, RenderResult } from "./orchestrator/types.ts";
export { VeryfrontRenderer } from "./orchestrator/ssr.ts";
export * from "./client/index.ts";
export * from "./layouts/index.ts";

import { type RendererOptions, VeryfrontRenderer } from "./orchestrator/ssr.ts";
import { warmupReactImports } from "../react/compat/ssr-adapter/server-loader.ts";

export async function createRenderer(options: RendererOptions): Promise<VeryfrontRenderer> {
  await warmupReactImports();

  const renderer = new VeryfrontRenderer(options);
  await renderer.initialize();
  return renderer;
}
