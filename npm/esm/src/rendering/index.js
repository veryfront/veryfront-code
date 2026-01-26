export { VeryfrontRenderer } from "./orchestrator/ssr.js";
export * from "./client/index.js";
export * from "./layouts/index.js";
export { getCompiledSnippet, renderSnippet, } from "./snippet-renderer.js";
import { VeryfrontRenderer } from "./orchestrator/ssr.js";
export async function createRenderer(options) {
    const renderer = new VeryfrontRenderer(options);
    await renderer.initialize();
    return renderer;
}
