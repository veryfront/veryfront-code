/**
 * Bundler category barrel for the Bundler contract, module lexer, and resolver helper.
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

// Compatibility aliases from the legacy bundler entrypoint. Preserve them so consumers
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
