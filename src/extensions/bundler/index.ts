/**
 * Bundler category barrel — Bundler contract, module lexer, and resolver helper.
 *
 * @module extensions/bundler
 */

export type {
  BuildContext,
  BuildFailure,
  BundleOptions,
  BundleOutput,
  Bundler,
  BundleResult,
  BundlerMessage,
  BundlerMessageLocation,
  BundlerPlugin,
  BundlerPluginBuild,
  Loader,
  Metafile,
  MetafileInput,
  MetafileOutput,
  OnLoadArgs,
  OnLoadResult,
  OnResolveArgs,
  OnResolveResult,
  StdinOptions,
  TransformOptions,
  TransformResult,
} from "./bundler.ts";

// Back-compat type aliases that the old top-level src/extensions/bundler.ts
// re-exported under esbuild-flavoured names. Preserve them so consumers
// importing `Plugin`, `PluginBuild`, `Message`, `ResolveResult`,
// `BuildOptions`, `BuildResult` from `veryfront/extensions/bundler` keep
// compiling without churn.
export type {
  BundleOptions as BuildOptions,
  BundleResult as BuildResult,
  BundlerMessage as Message,
  BundlerPlugin as Plugin,
  BundlerPluginBuild as PluginBuild,
  OnResolveResult as ResolveResult,
} from "./bundler.ts";

export type { ImportSpecifier, ModuleLexer } from "./module-lexer.ts";

export { build, context, getBundler, stop, transform } from "./helper.ts";
