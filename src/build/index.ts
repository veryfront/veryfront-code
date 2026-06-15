/**
 * Production build orchestration, MDX compilation, and multi-runtime
 * output generation for Deno, Node.js, and Bun targets.
 *
 * @module build
 */

export { compileMDXToJS } from "./compiler/mdx-to-js.ts";
export { compileAllMDX, watchMDX } from "./compiler/mdx-compiler/index.ts";
export { buildProduction } from "./production-build/build/build-orchestrator.ts";
export { LOCAL_RELEASE_ASSET_MANIFEST_PATH } from "./production-build/local-release-assets.ts";
export { buildEmbeddedPreset } from "./embedded/preset.ts";
