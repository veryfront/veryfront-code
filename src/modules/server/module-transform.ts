/**
 * Module Transform — shared ESM transform + SSR / release-rewrite sequence.
 *
 * Unifies the module-server transform paths:
 * `transformToESM → (SSR) applySSRImportRewritesAsync or (non-SSR)
 * rewriteReleaseDependencyImportsForModule`.
 *
 * Genuine differences that could not be cleanly unified:
 *   - `ensureFilenameDefaultExport` in the dev-module path runs between the ESM
 *     transform and the SSR rewrite; callers use `postTransform` for this.
 *   - HMR timestamp injection and `addReleaseVersionToFallbackImports` in the
 *     dev-module path run after the release rewrite; callers apply them manually
 *     on the returned code.
 *
 * @module modules/server/module-transform
 */

import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";
import { type TransformOptions, transformToESM } from "#veryfront/transforms/esm-transform.ts";
import { metrics, profilePhase } from "#veryfront/observability";
import { applySSRImportRewritesAsync, type SSRRewriteOptions } from "./ssr-import-rewriter.ts";
import {
  rewriteReleaseDependencyImportsForModule,
  type RewriteReleaseDependencyImportsOptions,
} from "#veryfront/release-assets/module-consumption.ts";
import { utf8ByteLength } from "#veryfront/utils/utf8-byte-length.ts";
import {
  MAX_SERVABLE_MODULE_OUTPUT_BYTES,
  MAX_SERVABLE_MODULE_SOURCE_BYTES,
} from "./module-limits.ts";

function assertBoundedModuleCode(
  value: unknown,
  label: string,
  maxBytes: number,
): asserts value is string {
  if (
    typeof value !== "string" ||
    utf8ByteLength(value, maxBytes) > maxBytes
  ) {
    throw new RangeError(`${label} exceeds ${maxBytes} UTF-8 bytes`);
  }
}

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
   * SSR import-rewrite options. Required when `isSSR=true` (the transform
   * throws otherwise, so an SSR module can never be served un-rewritten).
   * Pass `projectSlug`/`branch` or `crossProjectRef` plus a `resolveCacheBuster`.
   */
  ssrRewriteOptions?: SSRRewriteOptions;
  /**
   * Release-dependency import-rewrite options. Applied when `isSSR=false`.
   * Omit only when the caller deliberately does not serve release-bound code.
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

  assertBoundedModuleCode(
    source,
    "Module source",
    MAX_SERVABLE_MODULE_SOURCE_BYTES,
  );
  const doTransform = () => transformToESM(source, sourceFile, projectDir, adapter, transformOpts);
  let code = profile ? await profiledTransform(doTransform) : await doTransform();
  assertBoundedModuleCode(
    code,
    "Transformed module",
    MAX_SERVABLE_MODULE_OUTPUT_BYTES,
  );

  if (options.postTransform) {
    code = await options.postTransform(code);
    assertBoundedModuleCode(
      code,
      "Post-transformed module",
      MAX_SERVABLE_MODULE_OUTPUT_BYTES,
    );
  }

  if (isSSR) {
    if (!options.ssrRewriteOptions) {
      throw INVALID_ARGUMENT.create({
        detail: "transformModuleToServable requires ssrRewriteOptions when isSSR is true",
        context: { sourceFile },
      });
    }
    code = await applySSRImportRewritesAsync(code, options.ssrRewriteOptions);
  } else if (options.releaseRewriteOptions) {
    code = await rewriteReleaseDependencyImportsForModule(code, options.releaseRewriteOptions);
  }

  assertBoundedModuleCode(
    code,
    "Servable module",
    MAX_SERVABLE_MODULE_OUTPUT_BYTES,
  );
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
