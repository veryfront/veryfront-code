/**
 * Finalize stage - caching, HTTP bundling, final cleanup.
 *
 * Handles final processing steps:
 * - SSR: Bundle remaining HTTP imports that weren't in the import map
 * - Caching: Store results in transform cache
 */

import { bundleHttpImports } from "../../esm/http-bundler.ts";
import { cwd } from "../../../../platform/compat/process.ts";
import { join } from "std/path/mod.ts";
import { isSSR } from "../context.ts";
import { TransformStage, type TransformContext, type TransformPlugin } from "../types.ts";

/**
 * Finalize plugin - performs final cleanup and SSR HTTP bundling.
 */
export const finalizePlugin: TransformPlugin = {
  name: "finalize",
  stage: TransformStage.FINALIZE,

  transform(ctx: TransformContext): string {
    let code = ctx.code;

    if (isSSR(ctx)) {
      // SSR: Process remaining HTTP imports (ones not in import map)
      // This bundles external esm.sh modules that couldn't be resolved via npm:
      const httpCacheDir = join(cwd(), ".cache", "veryfront-http-bundle");
      code = bundleHttpImports(code, httpCacheDir, ctx.contentHash);
    }

    // Note: Caching is handled by the orchestrator after all stages complete

    return code;
  },
};

export default finalizePlugin;
