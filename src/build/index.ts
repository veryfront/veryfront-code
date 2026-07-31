/**
 * Production build orchestration, MDX compilation, and multi-runtime
 * output generation for Deno, Node.js, and Bun targets.
 *
 * @module build
 */

export {
  compileMDXToJS,
  type CompileToJSOptions,
  type CompileToJSResult,
} from "./compiler/mdx-to-js.ts";
export {
  compileAllMDX,
  type CompileOptions,
  type CompileResult,
  type MDXFrontmatter,
  watchMDX,
} from "./compiler/mdx-compiler/index.ts";
export {
  buildProduction,
  type BuildProductionOptions,
  type BuildProductionReleaseAssetProviders,
} from "./production-build/build/build-orchestrator.ts";
export { LOCAL_RELEASE_ASSET_MANIFEST_PATH } from "./production-build/local-release-assets.ts";
export { type BuildEmbeddedOptions, buildEmbeddedPreset } from "./embedded/preset.ts";
