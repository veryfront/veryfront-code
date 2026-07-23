/**
 * Production builds, MDX compilation, and embedded runtime bundles.
 *
 * @example Validate a production build without writing output.
 * ```ts
 * import { buildProduction, type BuildOptions } from "veryfront/build";
 *
 * const options: BuildOptions = {
 *   projectDir: ".",
 *   outputDir: ".veryfront/output",
 *   dryRun: true,
 * };
 * const stats = await buildProduction(options);
 * ```
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
export { buildProduction } from "./production-build/build/build-orchestrator.ts";
export { LOCAL_RELEASE_ASSET_MANIFEST_PATH } from "./production-build/local-release-assets.ts";
export {
  type BuildEmbeddedOptions,
  buildEmbeddedPreset,
  type EmbeddedBuildResult,
} from "./embedded/preset.ts";
export type { BuildOptions, BuildStats } from "#veryfront/server/build-types.ts";
