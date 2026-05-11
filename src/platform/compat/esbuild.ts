/**
 * Compatibility shim for code that previously imported esbuild via this path.
 *
 * The actual esbuild runtime now lives in the `@veryfront/ext-bundler-esbuild`
 * extension; this module forwards to the registered `Bundler` contract so
 * legacy callers keep working without importing `esbuild` directly.
 */

import {
  build as bundlerBuild,
  getBundler,
  stop as bundlerStop,
  transform as bundlerTransform,
} from "veryfront/extensions/bundler";
import type {
  BundleOptions,
  BundleResult,
  TransformOptions,
  TransformResult,
} from "veryfront/extensions/bundler";

export type {
  BundleOptions as BuildOptions,
  BundleResult as BuildResult,
  TransformOptions,
  TransformResult,
} from "veryfront/extensions/bundler";

/** esbuild-shaped facade backed by the registered `Bundler` contract. */
export function getEsbuild(): {
  build: (opts: BundleOptions) => Promise<BundleResult>;
  transform: (
    code: string,
    opts?: Omit<TransformOptions, "code">,
  ) => Promise<TransformResult>;
  stop: () => Promise<void>;
} {
  getBundler();
  return {
    build: bundlerBuild,
    transform: bundlerTransform,
    stop: bundlerStop,
  };
}

export const transform = bundlerTransform;
export const build = bundlerBuild;
export const stop = bundlerStop;

/** No-op kept for backwards compatibility with legacy bootstrap callers. */
export async function initializeEsbuild(): Promise<void> {
  getBundler();
}
