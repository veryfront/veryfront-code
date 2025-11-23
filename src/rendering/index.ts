// Render module public exports
// Docs: docs/app-router-ssr.md, docs/mdx.md, docs/client-routing.md

export type { RendererOptions, RenderResult } from "./orchestrator/types.ts";
export { VeryfrontRenderer } from "./orchestrator/ssr.ts";

// Client-side exports
export * from "./client/index.ts";

// Layout exports
export * from "./layouts/index.ts";

import { type RendererOptions, VeryfrontRenderer } from "./orchestrator/ssr.ts";

// Note: Test cleanup utilities (cleanupBundler, configureRendererNamespace) are in ./cleanup.ts
// They are NOT exported from index to avoid circular dependency
// Import them directly from ./cleanup.ts in tests

export async function createRenderer(options: RendererOptions): Promise<VeryfrontRenderer> {
  const renderer = new VeryfrontRenderer(options);
  await renderer.initialize();
  return renderer;
}
