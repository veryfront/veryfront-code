/**
 * Resolve relative stage - ./relative imports → full paths.
 *
 * Transforms relative imports based on target:
 * - SSR: Normalizes extensions to .js for temp file resolution
 * - Browser: Transforms to module server HTTP URLs
 */

import {
  blockExternalUrlImports,
  resolveRelativeImports,
  resolveRelativeImportsForSSR,
  resolveVeryfrontImports,
} from "../../esm/path-resolver.ts";
import { rendererLogger as logger } from "@veryfront/utils";
import { isBrowser, isSSR } from "../context.ts";
import { type TransformContext, type TransformPlugin, TransformStage } from "../types.ts";

/**
 * Resolve relative plugin - transforms relative imports to full paths.
 */
export const resolveRelativePlugin: TransformPlugin = {
  name: "resolve-relative",
  stage: TransformStage.RESOLVE_RELATIVE,

  async transform(ctx: TransformContext): Promise<string> {
    let code = ctx.code;

    if (isSSR(ctx)) {
      // SSR: Block external URL imports from unknown hosts
      // Allowed CDN hosts (esm.sh, deno.land) are kept as-is
      const urlBlockResult = await blockExternalUrlImports(code, ctx.filePath);
      code = urlBlockResult.code;

      if (urlBlockResult.blockedUrls.length > 0) {
        logger.warn("[PIPELINE:resolve-relative] Blocked external URL imports in SSR mode", {
          file: ctx.filePath.slice(-60),
          blockedUrls: urlBlockResult.blockedUrls,
        });
      }

      // SSR: Keep relative imports but normalize extensions to .js
      // SSRModuleLoader ensures all dependencies are transformed to temp directory
      code = await resolveRelativeImportsForSSR(code);

      // Rewrite @veryfront/* imports for npm compatibility (both Node.js and Deno)
      code = await resolveVeryfrontImports(code);
    } else if (isBrowser(ctx)) {
      // Browser: Rewrite imports to use module server (HTTP paths)
      code = await resolveRelativeImports(
        code,
        ctx.filePath,
        ctx.projectDir,
        ctx.moduleServerUrl,
      );
    }

    return code;
  },
};

export default resolveRelativePlugin;
