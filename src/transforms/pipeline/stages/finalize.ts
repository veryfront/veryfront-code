/**
 * Finalize stage - caching, HTTP normalization, final cleanup.
 *
 * Handles final processing steps:
 * - SSR: Normalize remaining esm.sh HTTP imports
 * - Caching: Store results in transform cache
 */

import { bundleHttpImports } from "../../esm/http-bundler.ts";
import { getHttpBundleCacheDir } from "#veryfront/utils/cache-dir.ts";
import { isSSR } from "../context.ts";
import { type TransformContext, type TransformPlugin, TransformStage } from "../types.ts";

/**
 * Finalize plugin - performs final cleanup and SSR HTTP normalization.
 */
export const finalizePlugin: TransformPlugin = {
  name: "finalize",
  stage: TransformStage.FINALIZE,

  async transform(ctx: TransformContext): Promise<string> {
    let code = ctx.code;

    if (isSSR(ctx)) {
      // SSR: Ensure esm.sh URLs use consistent target/external params if any remain
      const result = bundleHttpImports(code, getHttpBundleCacheDir(), ctx.contentHash);
      code = result instanceof Promise ? await result : result;
    }

    // Note: Caching is handled by the orchestrator after all stages complete

    return code;
  },
};

export default finalizePlugin;
