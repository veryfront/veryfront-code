/**
 * Bundler contract resolution helper.
 *
 * Core code uses this thin wrapper instead of importing `esbuild` directly,
 * so the bundler implementation lives in `@veryfront/ext-esbuild` (or any
 * other extension that satisfies the contract).
 *
 * @module extensions/bundler
 */

import { resolve as resolveContract } from "./contracts.ts";
import type {
  BuildContext,
  BundleOptions,
  Bundler,
  BundleResult,
  TransformOptions,
  TransformResult,
} from "./interfaces/bundler.ts";

/** Resolve the registered `Bundler` contract. Throws if no extension provides it. */
export function getBundler(): Bundler {
  return resolveContract<Bundler>("Bundler");
}

/** Convenience wrapper: `bundler.bundle(opts)`. */
export function build(options: BundleOptions): Promise<BundleResult> {
  return getBundler().bundle(options);
}

/**
 * Convenience wrapper that mirrors esbuild's `transform(code, options)`
 * positional signature so call-sites migrating off esbuild keep their shape.
 */
export function transform(
  code: string,
  options: Omit<TransformOptions, "code"> = {},
): Promise<TransformResult> {
  return getBundler().transform({ code, ...options });
}

/**
 * Stop the bundler. Optional — extension teardown will also call this. Provided
 * so tests that previously called `esbuild.stop()` keep working.
 */
export async function stop(): Promise<void> {
  const b = getBundler();
  if (b.stop) await b.stop();
}

/** Create an incremental build context (watch/rebuild mode). */
export function context(options: BundleOptions): Promise<BuildContext> {
  const b = getBundler();
  if (!b.context) {
    throw new Error("Registered Bundler extension does not support context() (incremental builds)");
  }
  return b.context(options);
}

export type {
  BuildContext,
  BuildFailure,
  BundleOptions,
  BundleOptions as BuildOptions,
  BundleOutput,
  Bundler,
  BundleResult,
  BundleResult as BuildResult,
  BundlerMessage,
  BundlerMessage as Message,
  BundlerPlugin,
  BundlerPlugin as Plugin,
  BundlerPluginBuild,
  BundlerPluginBuild as PluginBuild,
  Loader,
  Metafile,
  OnLoadArgs,
  OnLoadResult,
  OnResolveArgs,
  OnResolveResult,
  OnResolveResult as ResolveResult,
  StdinOptions,
  TransformOptions,
  TransformResult,
} from "./interfaces/bundler.ts";
