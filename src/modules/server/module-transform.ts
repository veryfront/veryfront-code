/**
 * Module Transform — shared ESM transform + SSR / release-rewrite sequence.
 *
 * Unifies the three near-identical copies in module-server.ts and the fourth
 * in module-batch-handler.ts: `transformToESM → (SSR) applySSRImportRewritesAsync
 * or (non-SSR) rewriteReleaseDependencyImportsForModule`.
 *
 * Genuine differences that could not be cleanly unified:
 *   - `ensureFilenameDefaultExport` in the dev-module path runs between the ESM
 *     transform and the SSR rewrite; callers use `postTransform` for this.
 *   - HMR timestamp injection and `addReleaseVersionToFallbackImports` in the
 *     dev-module path run after the release rewrite; callers apply them manually
 *     on the returned code.
 *   - The batch handler (copy 4) never rewrites release dependencies on the
 *     non-SSR path; callers simply omit `releaseRewriteOptions`.
 *
 * @module modules/server/module-transform
 */

import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { type TransformOptions, transformToESM } from "#veryfront/transforms/esm-transform.ts";
import { metrics, profilePhase } from "#veryfront/observability";
import { applySSRImportRewritesAsync, type SSRRewriteOptions } from "./ssr-import-rewriter.ts";
import {
  rewriteReleaseDependencyImportsForModule,
  type RewriteReleaseDependencyImportsOptions,
} from "#veryfront/release-assets/module-consumption.ts";

/** Options for `transformModuleToServable`. */
export interface TransformModuleToServableOptions {
  /** Raw source code to transform. */
  source: string;
  /** Source file path used for source-map generation and type detection. */
  sourceFile: string;
  /** Project root directory passed to the transform pipeline. */
  projectDir: string;
  /** Platform runtime adapter. */
  adapter: RuntimeAdapter;
  /** Options forwarded directly to `transformToESM`. */
  transformOpts: TransformOptions;
  /** Whether this is an SSR (server-side rendering) request. */
  isSSR: boolean;
  /**
   * Optional hook called after `transformToESM` and before SSR / release
   * rewrites. Use for steps like `ensureFilenameDefaultExport` that must
   * occur between the two stages.
   */
  postTransform?: (code: string) => string | Promise<string>;
  /**
   * SSR import-rewrite options. Applied when `isSSR=true`.
   * Pass `projectSlug`/`branch` or `crossProjectRef` plus a `resolveCacheBuster`.
   */
  ssrRewriteOptions?: SSRRewriteOptions;
  /**
   * Release-dependency import-rewrite options. Applied when `isSSR=false`.
   * Omit (or pass `undefined`) to skip release dependency rewriting — used by
   * the batch handler which has no non-SSR release rewrite step.
   */
  releaseRewriteOptions?: RewriteReleaseDependencyImportsOptions;
  /**
   * When `true`, wraps `transformToESM` in observability profiling
   * (`module.transform` phase + metrics). Set by module-server.ts; the batch
   * handler leaves this `false`.
   */
  profile?: boolean;
}

/**
 * Run the shared module-serving transform sequence:
 *
 * 1. `transformToESM` (optionally profiled)
 * 2. Optional `postTransform` hook (e.g. `ensureFilenameDefaultExport`)
 * 3a. If SSR: `applySSRImportRewritesAsync`
 * 3b. If not SSR: `rewriteReleaseDependencyImportsForModule` (when options provided)
 *
 * @returns Transformed JavaScript source code ready to serve.
 */
export async function transformModuleToServable(
  options: TransformModuleToServableOptions,
): Promise<string> {
  const {
    source,
    sourceFile,
    projectDir,
    adapter,
    transformOpts,
    isSSR,
    profile = false,
  } = options;

  const doTransform = () => transformToESM(source, sourceFile, projectDir, adapter, transformOpts);
  let code = profile ? await profiledTransform(doTransform) : await doTransform();

  if (options.postTransform) {
    code = await options.postTransform(code);
  }

  if (isSSR) {
    if (options.ssrRewriteOptions) {
      code = await applySSRImportRewritesAsync(code, options.ssrRewriteOptions);
    }
  } else if (options.releaseRewriteOptions) {
    code = await rewriteReleaseDependencyImportsForModule(code, options.releaseRewriteOptions);
  }

  return code;
}

/** Wrap a transform function with `module.transform` profiling and metrics. */
async function profiledTransform<T>(fn: () => Promise<T>): Promise<T> {
  const startedAt = performance.now();
  try {
    return await profilePhase("module.transform", fn);
  } finally {
    metrics.recordModuleTransform(performance.now() - startedAt);
  }
}
